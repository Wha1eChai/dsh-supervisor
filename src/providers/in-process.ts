import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock, type Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { classifyAgent, resolveControl } from '../classify.js'
import { FleetService } from '../service.js'
import {
  FleetError,
  type FleetAgentView,
  type FleetCallerOptions,
  type FleetCancelOptions,
  type FleetEvent,
  type FleetEventType,
  type FleetInspectOptions,
  type FleetInspectView,
  type FleetListFilter,
  type FleetMessageSummary,
} from '../types.js'

/** Runtime configuration consumed by the in-process Fleet provider. */
export interface InProcessFleetConfig {
  defaultTailMessages: number
  maxTailMessages: number
  maxMessageTextChars: number
}

/** Process-local Fleet provider backed by `ctx.agents`. */
export class InProcessFleetProvider extends FleetService {
  static inject = ['agents']

  private readonly listeners = new Set<(event: FleetEvent) => void | Promise<void>>()
  private active = true

  /**
   * Mount the provider and its agent lifecycle bridge.
   * @param ctx - Cordis context with the required agents service.
   * @param config - validated provider tunables.
   */
  constructor(ctx: Context, private readonly config: InProcessFleetConfig) {
    super(ctx)
    // Agent lifecycle events carry scoped subjects, so the host-level Fleet bridge listens globally.
    ctx.on('agent/created', ({ agent }) => { this.publish('created', agent) }, { global: true })
    ctx.on('agent/status', ({ agent }) => { this.publish('status', agent) }, { global: true })
    ctx.on('agent/disposed', ({ agent }) => { this.publish('disposed', agent) }, { global: true })
    ctx.effect(() => () => {
      this.active = false
      this.listeners.clear()
    }, 'fleet.eventBridge()')
  }

  /** List live agents from the required Agent registry. */
  list(filter: FleetListFilter = {}): FleetAgentView[] {
    this.requireActive()
    return this.ctx.agents.list()
      .map(agent => this.project(agent))
      .filter(view => !filter.rootsOnly || view.kind === 'root')
      .filter(view => !filter.runningOnly || view.status === 'running')
  }

  /** Inspect one live agent and return only configured transcript summaries. */
  inspect(sessionId: string, options: FleetInspectOptions = {}): FleetInspectView {
    this.requireActive()
    const agent = this.requireAgent(sessionId)
    const tailCount = this.resolveTailMessages(options)
    const tailMessages = agent.session.deriveMessages()
      .filter(isSummarizableMessage)
      .slice(-tailCount)
      .map(message => this.summarize(message))
    return { ...this.project(agent), tailMessages }
  }

  /** Queue a follow-up on a root agent. */
  send(sessionId: string, text: string, options: FleetCallerOptions = {}): { messageId: string } {
    this.requireActive()
    const agent = this.requireWritableRoot(sessionId, options)
    const message = createFleetMessage(text)
    agent.followup(message)
    return { messageId: message.id }
  }

  /** Submit steering on a root agent. */
  steer(sessionId: string, text: string, options: FleetCallerOptions = {}): { messageId: string } {
    this.requireActive()
    const agent = this.requireWritableRoot(sessionId, options)
    const message = createFleetMessage(text)
    agent.steer(message)
    return { messageId: message.id }
  }

  /** Cancel a root agent with the stable Fleet hook cause. */
  cancel(sessionId: string, options: FleetCancelOptions = {}): { accepted: true } {
    this.requireActive()
    const agent = this.requireWritableRoot(sessionId, options)
    agent.cancel({ kind: 'hook', reason: 'fleet-cancel' }, { keepInbox: options.keepInbox })
    return { accepted: true }
  }

  /** Register an idempotently disposable Fleet event listener. */
  subscribe(listener: (event: FleetEvent) => void | Promise<void>): () => void {
    this.requireActive()
    this.listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
    }
  }

  /** Resolve request options against validated deployment configuration. */
  private resolveTailMessages(options: FleetInspectOptions): number {
    const requested = options.tailMessages === undefined
      ? this.config.defaultTailMessages
      : options.tailMessages
    if (!Number.isSafeInteger(requested) || requested <= 0) {
      throw new RangeError('dsh-supervisor: tailMessages must be a positive integer')
    }
    return Math.min(requested, this.config.maxTailMessages)
  }

  /** Reject operations through a retained service reference after provider unload. */
  private requireActive(): void {
    if (this.active) return
    throw new FleetError('fleet-unavailable', 'fleet-unavailable: Fleet provider is unloaded')
  }

  /** Project one Agent into the public JSON-safe view. */
  private project(agent: Agent): FleetAgentView {
    const kind = classifyAgent(agent)
    const header = agent.session.header
    const lastEvent = agent.session.events.at(-1)
    return {
      sessionId: agent.id,
      status: agent.status,
      kind,
      control: resolveControl(this.ctx, kind),
      ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      blank: !agent.session.events.some(event => event.type === 'turn/start'),
      queueCount: agent.inbox.nextTurn.length + agent.inbox.nextStep.length,
      ...(lastEvent === undefined ? {} : { updatedAt: lastEvent.time }),
    }
  }

  /** Find one live Agent by its public string id. */
  private requireAgent(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new FleetError('fleet-not-found', `fleet-not-found: live session "${sessionId}" was not found`)
    }
    return agent
  }

  /** Enforce self-target and delegated-write policy before any Agent method call. */
  private requireWritableRoot(sessionId: string, options: FleetCallerOptions): Agent {
    if (options.callerSessionId === sessionId) {
      throw new FleetError('fleet-self-target', `fleet-self-target: session "${sessionId}" cannot control itself`)
    }
    const agent = this.requireAgent(sessionId)
    if (classifyAgent(agent) === 'root') return agent
    if (this.ctx.get('subagents') === undefined) {
      throw new FleetError('fleet-observe-only', `fleet-observe-only: delegated session "${sessionId}" has no subagent seam`)
    }
    throw new FleetError(
      'fleet-delegated-write-deferred',
      `fleet-delegated-write-deferred: delegated writes are deferred for session "${sessionId}"`,
    )
  }

  /** Convert one message to a bounded plain-text summary. */
  private summarize(message: Message & { role: 'user' | 'assistant' }): FleetMessageSummary {
    const text = extractText(message.content).slice(0, this.config.maxMessageTextChars)
    return { messageId: message.id, role: message.role, text }
  }

  /** Deliver a projected lifecycle event without letting subscribers disrupt Agent lifecycle. */
  private publish(type: FleetEventType, agent: Agent): void {
    if (!this.active) return
    const event: FleetEvent = { type, agent: this.project(agent) }
    for (const listener of [...this.listeners]) {
      try {
        const returned = listener(event)
        void Promise.resolve(returned).catch((error) => {
          this.ctx.logger.warn(`fleet "${agent.id}": ${type} listener rejected: ${String(error)}`)
        })
      } catch (error) {
        this.ctx.logger.warn(`fleet "${agent.id}": ${type} listener threw: ${String(error)}`)
      }
    }
  }
}

/** Build the exact model-facing message required by Fleet root writes. */
function createFleetMessage(text: string) {
  if (text.trim().length === 0) {
    throw new FleetError('fleet-empty-text', 'fleet-empty-text: message text must not be empty')
  }
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-supervisor' },
  })
}

/** Keep only the user and assistant roles promised by Fleet inspect. */
function isSummarizableMessage(message: Message): message is Message & { role: 'user' | 'assistant' } {
  return message.role === 'user' || message.role === 'assistant'
}

/** Flatten visible text blocks without exposing tool arguments or raw events. */
function extractText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}
