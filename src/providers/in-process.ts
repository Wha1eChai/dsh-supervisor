import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock, type Message, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-title'
import { classifyAgent, resolveControl } from '../classify.js'
import { FleetService } from '../service.js'
import {
  parseFleetRelaySource,
  type FleetDeliveryId,
  type FleetReplyReceipt,
} from '../relay.js'
import {
  FleetError,
  type FleetAgentKind,
  type FleetAgentView,
  type FleetCallerOptions,
  type FleetCancelOptions,
  type FleetDeliveryReceipt,
  type FleetEvent,
  type FleetEventType,
  type FleetInspectOptions,
  type FleetInspectView,
  type FleetListFilter,
  type FleetMessageSummary,
  type FleetRelayView,
  type FleetReplyMessage,
  type FleetReplyResult,
  type FleetReplyWaitOptions,
  type FleetSelectedCancelOptions,
  type FleetSelectedWriteOptions,
  type FleetSendReceipt,
  type FleetTargetInspectOptions,
  type FleetTargetInspectView,
  type FleetTargetListOptions,
  type FleetTargetView,
} from '../types.js'

/** Runtime configuration consumed by the in-process Fleet provider. */
export interface InProcessFleetConfig {
  defaultTailMessages: number
  maxTailMessages: number
  maxMessageTextChars: number
  targetRefTtlMs: number
  selectionTtlMs: number
  maxSelectionsPerCaller: number
  replyReceiptTtlMs: number
  maxReplyRecordsPerCaller: number
  maxReplyMessages: number
  maxReplyTextChars: number
}

interface TargetRecord {
  callerAgent: Agent
  callerSessionId: string
  targetAgent: Agent
  targetSessionId: string
  expiresAt: number
}

interface SelectionRecord extends TargetRecord {}

interface ReplyWaiter {
  resolve(result: FleetReplyResult): void
  reject(error: unknown): void
  cleanup(): void
}

interface ReplyRecord {
  receipt: FleetReplyReceipt
  callerAgent: Agent
  callerSessionId: string
  targetAgent: Agent
  targetSessionId: string
  messageId: string
  deliveryId: FleetDeliveryId
  expiresAt: number
  turn?: number
  admitted: boolean
  assistantMessages: FleetReplyMessage[]
  omittedAssistantMessages: number
  result?: FleetReplyResult
  waiter?: ReplyWaiter
  observing: boolean
}

/** Process-local Fleet provider backed by `ctx.agents`. */
export class InProcessFleetProvider extends FleetService {
  static inject = ['agents']

  private readonly listeners = new Set<(event: FleetEvent) => void | Promise<void>>()
  private readonly runtimeKinds = new WeakMap<Agent, FleetAgentKind>()
  private readonly targetReferences = new Map<string, TargetRecord>()
  private readonly selections = new Map<string, SelectionRecord>()
  private readonly replies = new Map<string, ReplyRecord>()
  private active = true

  /**
   * Mount the provider and its agent lifecycle bridge.
   * @param ctx - Cordis context with the required agents service.
   * @param config - validated provider tunables.
   */
  constructor(ctx: Context, private readonly config: InProcessFleetConfig) {
    super(ctx)
    // Agent lifecycle events carry scoped subjects, so the host-level Fleet bridge listens globally.
    ctx.on('agent/created', ({ agent }) => { this.publishLive('created', agent) }, { global: true })
    ctx.on('agent/status', ({ agent }) => { this.publishLive('status', agent) }, { global: true })
    ctx.on('agent/inbox/claimed', payload => { this.onInboxClaimed(payload) }, { global: true })
    ctx.on('agent/inbox/discarded', payload => { this.onInboxDiscarded(payload) }, { global: true })
    ctx.on('session/event', (session, event) => { this.onSessionEvent(session, event) }, { global: true })
    ctx.on('agent/disposed', ({ agent }) => { this.publishDisposed(agent) }, { global: true })

    const agents = ctx.agents.list()
    const roots = new Set(ctx.agents.roots())
    for (const agent of agents) this.classifyLive(agent, roots)

    ctx.effect(() => () => {
      this.active = false
      const error = new FleetError('fleet-unavailable', 'fleet-unavailable: Fleet provider is unloaded')
      for (const record of [...this.replies.values()]) this.rejectReply(record, error)
      this.listeners.clear()
      this.targetReferences.clear()
      this.selections.clear()
      this.replies.clear()
    }, 'fleet.eventBridge()')
  }

  /** List live agents from the required Agent registry. */
  list(filter: FleetListFilter = {}): FleetAgentView[] {
    this.requireActive()
    const agents = this.ctx.agents.list()
    const roots = new Set(this.ctx.agents.roots())
    return agents
      .map(agent => this.project(agent, this.classifyLive(agent, roots)))
      .filter(view => !filter.rootsOnly || view.kind === 'root')
      .filter(view => !filter.runningOnly || view.status === 'running')
  }

  /** Inspect one live agent and return only configured transcript summaries. */
  inspect(sessionId: string, options: FleetInspectOptions = {}): FleetInspectView {
    this.requireActive()
    const agent = this.requireAgent(sessionId)
    const tailCount = this.resolveTailMessages(options)
    const candidates = agent.session.deriveMessages().filter(isSummarizableMessage)
    const tailMessages = candidates
      .slice(-tailCount)
      .map(message => this.summarize(message))
    return {
      ...this.project(agent, this.classifyLive(agent)),
      omittedMessages: Math.max(0, candidates.length - tailMessages.length),
      tailMessages,
    }
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

  /** Issue caller-bound short-lived references for live targets. */
  listTargets(options: FleetTargetListOptions): FleetTargetView[] {
    this.requireActive()
    const caller = this.requireCaller(options.callerAgent, options.callerSessionId)
    const now = Date.now()
    this.pruneExpired(now)
    const agents = this.ctx.agents.list()
    const roots = new Set(this.ctx.agents.roots())
    return agents
      .map((agent) => ({ agent, view: this.project(agent, this.classifyLive(agent, roots)) }))
      .filter(({ view }) => !options.rootsOnly || view.kind === 'root')
      .filter(({ view }) => !options.runningOnly || view.status === 'running')
      .map(({ agent, view }) => {
        const reference = this.issueTargetReference(caller, agent, now)
        return {
          ...view,
          targetRef: reference.handle,
          targetRefExpiresAt: reference.expiresAt,
        }
      })
  }

  /** Inspect one target reference and issue a write selection when current policy permits it. */
  inspectTarget(targetRef: string, options: FleetTargetInspectOptions): FleetTargetInspectView {
    this.requireActive()
    const now = Date.now()
    this.pruneExpired(now)
    const record = this.requireTargetReference(targetRef, options.callerAgent, options.callerSessionId)
    const agent = this.inspectAgent(record.targetAgent, options)
    if (record.callerAgent === record.targetAgent || agent.kind !== 'root') return { agent }
    return { agent, selection: this.issueSelection(record, now) }
  }

  /** Queue a follow-up through one single-attempt confirmed target selection. */
  sendSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): FleetSendReceipt {
    this.requireActive()
    validateMessageText(text)
    const selection = this.requireSelection(selectionHandle, options.callerAgent, options.callerSessionId)
    const agent = this.requireWritableSelected(selection)
    const message = createFleetRelayMessage(text, selection.callerAgent)
    const source = relaySource(message)
    const reply = this.issueReplyRecord(selection, message.id, source.deliveryId)
    this.selections.delete(selectionHandle)
    try {
      agent.followup(message)
    } catch (error) {
      this.replies.delete(reply.receipt)
      throw error
    }
    return {
      sessionId: selection.targetSessionId,
      messageId: message.id,
      deliveryId: source.deliveryId,
      replyReceipt: reply.receipt,
      replyReceiptExpiresAt: reply.expiresAt,
    }
  }

  /** Observe the complete turn that claims one selected follow-up. */
  async waitForReply(replyReceipt: string, options: FleetReplyWaitOptions): Promise<FleetReplyResult> {
    this.requireActive()
    options.signal?.throwIfAborted()
    const record = this.requireReplyRecord(replyReceipt, options.callerAgent, options.callerSessionId)
    if (record.observing) throw invalidReply()
    record.observing = true
    if (record.result !== undefined) {
      this.replies.delete(replyReceipt)
      return record.result
    }
    return new Promise<FleetReplyResult>((resolve, reject) => {
      const onAbort = () => {
        this.rejectReply(record, options.signal?.reason ?? new Error('Fleet reply observation aborted'))
      }
      const cleanup = () => { options.signal?.removeEventListener('abort', onAbort) }
      record.waiter = { resolve, reject, cleanup }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted === true) onAbort()
    })
  }

  /** Submit steering through one single-attempt confirmed target selection. */
  steerSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): FleetDeliveryReceipt {
    this.requireActive()
    validateMessageText(text)
    const record = this.requireSelection(selectionHandle, options.callerAgent, options.callerSessionId)
    const agent = this.requireWritableSelected(record)
    const message = createFleetRelayMessage(text, record.callerAgent)
    this.selections.delete(selectionHandle)
    agent.steer(message)
    return { sessionId: record.targetSessionId, messageId: message.id, deliveryId: relaySource(message).deliveryId }
  }

  /** Cancel through one single-attempt confirmed target selection. */
  cancelSelected(
    selectionHandle: string,
    options: FleetSelectedCancelOptions,
  ): { sessionId: string; accepted: true } {
    this.requireActive()
    const record = this.requireSelection(selectionHandle, options.callerAgent, options.callerSessionId)
    const agent = this.requireWritableSelected(record)
    this.selections.delete(selectionHandle)
    agent.cancel({ kind: 'hook', reason: 'fleet-cancel' }, { keepInbox: options.keepInbox })
    return { sessionId: record.targetSessionId, accepted: true }
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

  /** Inspect one exact live Agent without another session-id lookup. */
  private inspectAgent(agent: Agent, options: FleetInspectOptions): FleetInspectView {
    const tailCount = this.resolveTailMessages(options)
    const candidates = agent.session.deriveMessages().filter(isSummarizableMessage)
    const tailMessages = candidates
      .slice(-tailCount)
      .map(message => this.summarize(message))
    return {
      ...this.project(agent, this.classifyLive(agent)),
      omittedMessages: Math.max(0, candidates.length - tailMessages.length),
      tailMessages,
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

  /** Classify and cache one exact live Agent from a root identity snapshot. */
  private classifyLive(
    agent: Agent,
    roots: ReadonlySet<Agent> = new Set(this.ctx.agents.roots()),
  ): FleetAgentKind {
    const kind = classifyAgent(agent, roots)
    this.runtimeKinds.set(agent, kind)
    return kind
  }

  /** Project one Agent into the public JSON-safe view using an explicit runtime classification. */
  private project(agent: Agent, kind: FleetAgentKind): FleetAgentView {
    const header = agent.session.header
    const lastEvent = agent.session.events.at(-1)
    const title = this.ctx.get('sessionTitle')?.get(agent.session)?.title
    return {
      sessionId: agent.id,
      status: agent.status,
      kind,
      control: resolveControl(this.ctx, kind),
      ...(title === undefined ? {} : { title }),
      ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      blank: !agent.session.events.some(event => event.type === 'turn/start'),
      queueCount: agent.inbox.nextTurn.length + agent.inbox.nextStep.length,
      ...(lastEvent === undefined ? {} : { updatedAt: lastEvent.time }),
    }
  }

  /** Resolve an exact live caller before issuing or using confirmed-target state. */
  private requireCaller(callerAgent: Agent, callerSessionId: string): Agent {
    const caller = this.ctx.agents.get(SessionId(callerSessionId))
    if (caller !== callerAgent) {
      throw new FleetError(
        'fleet-caller-unavailable',
        'fleet-caller-unavailable: the owning Fleet session is not the exact live Agent. No action was taken. '
          + 'Do not substitute another Fleet session. Relist or ask the user.',
      )
    }
    return caller
  }

  /** Find one live Agent by its public string id. */
  private requireAgent(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new FleetError('fleet-not-found', `fleet-not-found: live session "${sessionId}" was not found`)
    }
    return agent
  }

  /** Issue or reuse one target reference for an exact caller/target pair. */
  private issueTargetReference(
    callerAgent: Agent,
    targetAgent: Agent,
    now: number,
  ): { handle: string; expiresAt: number } {
    for (const [handle, record] of this.targetReferences) {
      if (record.callerAgent === callerAgent && record.targetAgent === targetAgent) {
        return { handle, expiresAt: record.expiresAt }
      }
    }
    const handle = createToken('ft_', this.targetReferences)
    const expiresAt = now + this.config.targetRefTtlMs
    this.targetReferences.set(handle, {
      callerAgent,
      callerSessionId: callerAgent.id,
      targetAgent,
      targetSessionId: targetAgent.id,
      expiresAt,
    })
    return { handle, expiresAt }
  }

  /** Resolve one caller-bound target reference and invalidate mismatched submissions. */
  private requireTargetReference(targetRef: string, callerAgent: Agent, callerSessionId: string): TargetRecord {
    const record = this.targetReferences.get(targetRef)
    if (record === undefined) throw invalidTargetReference()
    const caller = this.requireCaller(callerAgent, callerSessionId)
    if (record.callerSessionId !== callerSessionId || record.callerAgent !== caller) {
      this.targetReferences.delete(targetRef)
      throw invalidTargetReference()
    }
    const target = this.ctx.agents.get(SessionId(record.targetSessionId))
    if (target !== record.targetAgent) {
      this.targetReferences.delete(targetRef)
      throw invalidTargetReference()
    }
    return record
  }

  /** Issue one bounded single-attempt selection for an exact caller/target pair. */
  private issueSelection(record: TargetRecord, now: number): { handle: string; expiresAt: number } {
    this.pruneExpired(now)
    const callerHandles = [...this.selections]
      .filter(([, selection]) => selection.callerAgent === record.callerAgent)
      .map(([handle]) => handle)
    while (callerHandles.length >= this.config.maxSelectionsPerCaller) {
      const oldest = callerHandles.shift()
      if (oldest !== undefined) this.selections.delete(oldest)
    }
    const handle = createToken('fs_', this.selections)
    const expiresAt = now + this.config.selectionTtlMs
    this.selections.set(handle, { ...record, expiresAt })
    return { handle, expiresAt }
  }

  /** Resolve one single-attempt selection and invalidate mismatched submissions. */
  private requireSelection(selectionHandle: string, callerAgent: Agent, callerSessionId: string): SelectionRecord {
    const now = Date.now()
    this.pruneExpired(now)
    const record = this.selections.get(selectionHandle)
    if (record === undefined) throw invalidSelection()
    let caller: Agent
    try {
      caller = this.requireCaller(callerAgent, callerSessionId)
    } catch (error) {
      this.selections.delete(selectionHandle)
      throw error
    }
    if (record.callerSessionId !== callerSessionId || record.callerAgent !== caller) {
      this.selections.delete(selectionHandle)
      throw invalidSelection()
    }
    const target = this.ctx.agents.get(SessionId(record.targetSessionId))
    if (target !== record.targetAgent) {
      this.selections.delete(selectionHandle)
      throw invalidSelection()
    }
    return record
  }

  /** Recheck current root-write policy for an exact selected target. */
  private requireWritableSelected(record: SelectionRecord): Agent {
    if (record.callerAgent === record.targetAgent) {
      throw new FleetError(
        'fleet-self-target',
        `fleet-self-target: session "${record.targetSessionId}" cannot control itself`,
      )
    }
    if (this.classifyLive(record.targetAgent) === 'root') return record.targetAgent
    if (this.ctx.get('subagents') === undefined) {
      throw new FleetError(
        'fleet-observe-only',
        `fleet-observe-only: delegated session "${record.targetSessionId}" has no subagent seam`,
      )
    }
    throw new FleetError(
      'fleet-delegated-write-deferred',
      `fleet-delegated-write-deferred: delegated writes are deferred for session "${record.targetSessionId}"`,
    )
  }

  /** Reserve one bounded caller-owned reply record before the follow-up side effect. */
  private issueReplyRecord(
    selection: SelectionRecord,
    messageId: string,
    deliveryId: FleetDeliveryId,
  ): ReplyRecord {
    const now = Date.now()
    this.pruneExpired(now)
    const callerCount = [...this.replies.values()]
      .filter(record => record.callerAgent === selection.callerAgent)
      .length
    if (callerCount >= this.config.maxReplyRecordsPerCaller) {
      throw new FleetError(
        'fleet-reply-capacity',
        'fleet-reply-capacity: the caller has too many unconsumed Fleet reply records. '
          + 'No action was taken. Observe or abandon an earlier reply before retrying.',
      )
    }
    const receipt = createToken('fr_', this.replies) as FleetReplyReceipt
    const record: ReplyRecord = {
      receipt,
      callerAgent: selection.callerAgent,
      callerSessionId: selection.callerSessionId,
      targetAgent: selection.targetAgent,
      targetSessionId: selection.targetSessionId,
      messageId,
      deliveryId,
      expiresAt: now + this.config.replyReceiptTtlMs,
      admitted: false,
      assistantMessages: [],
      omittedAssistantMessages: 0,
      observing: false,
    }
    this.replies.set(receipt, record)
    return record
  }

  /** Resolve one caller-bound reply capability without substituting another delivery. */
  private requireReplyRecord(
    replyReceipt: string,
    callerAgent: Agent,
    callerSessionId: string,
  ): ReplyRecord {
    this.pruneExpired(Date.now())
    const record = this.replies.get(replyReceipt)
    if (record === undefined) throw invalidReply()
    let caller: Agent
    try {
      caller = this.requireCaller(callerAgent, callerSessionId)
    } catch (error) {
      this.replies.delete(replyReceipt)
      throw error
    }
    if (record.callerAgent !== caller || record.callerSessionId !== callerSessionId) {
      this.replies.delete(replyReceipt)
      throw invalidReply()
    }
    if (record.result === undefined
      && this.ctx.agents.get(SessionId(record.targetSessionId)) !== record.targetAgent) {
      this.settleReply(record, {
        ...this.replyResultBase(record),
        outcome: 'target-unavailable',
        ...(record.turn === undefined ? {} : { turn: record.turn }),
        admitted: record.admitted,
      })
    }
    return record
  }

  /** Bind one exact delivered Fleet follow-up to the turn that claimed it. */
  private onInboxClaimed(payload: { agent: Agent; message: UserMessage; turn: number }): void {
    if (!this.active) return
    for (const record of this.replies.values()) {
      if (record.result === undefined
        && record.targetAgent === payload.agent
        && record.messageId === payload.message.id) {
        record.turn = payload.turn
      }
    }
  }

  /** Settle one accepted follow-up that left the inbox before any turn claimed it. */
  private onInboxDiscarded(payload: { agent: Agent; message: UserMessage }): void {
    if (!this.active) return
    for (const record of this.replies.values()) {
      if (record.result === undefined
        && record.targetAgent === payload.agent
        && record.messageId === payload.message.id) {
        this.settleReply(record, {
          ...this.replyResultBase(record),
          outcome: 'discarded',
          assistantMessages: [],
          omittedAssistantMessages: 0,
        })
      }
    }
  }

  /** Fold committed events from the exact claimed turn into a bounded terminal result. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (!this.active) return
    for (const record of this.replies.values()) {
      if (record.result !== undefined || record.targetAgent.session !== session) continue
      if (event.type === 'user/message' && event.data.id === record.messageId) {
        record.admitted = true
        continue
      }
      if (record.turn === undefined) continue
      if (event.type === 'assistant/message' && event.data.turn === record.turn) {
        const text = extractText(event.data.message.content)
        if (text.length === 0) continue
        const textTruncated = text.length > this.config.maxReplyTextChars
        record.assistantMessages.push({
          messageId: event.data.message.id,
          step: event.data.step,
          text: text.slice(0, this.config.maxReplyTextChars),
          textTruncated,
        })
        while (record.assistantMessages.length > this.config.maxReplyMessages) {
          record.assistantMessages.shift()
          record.omittedAssistantMessages += 1
        }
        continue
      }
      if (event.type === 'turn/end' && event.data.turn === record.turn) {
        this.settleReply(record, {
          ...this.replyResultBase(record),
          outcome: 'turn-ended',
          turn: record.turn,
          admitted: record.admitted,
          turnEndReason: event.data.reason,
        })
      }
    }
  }

  /** Snapshot common reply fields without exposing live Provider state. */
  private replyResultBase(record: ReplyRecord) {
    return {
      sessionId: record.targetSessionId,
      messageId: record.messageId,
      deliveryId: record.deliveryId,
      assistantMessages: record.assistantMessages.map(message => ({ ...message })),
      omittedAssistantMessages: record.omittedAssistantMessages,
    }
  }

  /** Commit one first-wins terminal reply result and release its sole observer. */
  private settleReply(record: ReplyRecord, result: FleetReplyResult): void {
    if (record.result !== undefined) return
    record.result = result
    const waiter = record.waiter
    if (waiter === undefined) return
    record.waiter = undefined
    waiter.cleanup()
    this.replies.delete(record.receipt)
    waiter.resolve(result)
  }

  /** Reject one active observation and release every listener it owns. */
  private rejectReply(record: ReplyRecord, error: unknown): void {
    const waiter = record.waiter
    record.waiter = undefined
    waiter?.cleanup()
    this.replies.delete(record.receipt)
    waiter?.reject(error)
  }

  /** Remove expired confirmed-target state without a background timer. */
  private pruneExpired(now: number): void {
    for (const [handle, record] of this.targetReferences) {
      if (now >= record.expiresAt) this.targetReferences.delete(handle)
    }
    for (const [handle, record] of this.selections) {
      if (now >= record.expiresAt) this.selections.delete(handle)
    }
    for (const [receipt, record] of this.replies) {
      if (!record.observing && now >= record.expiresAt) this.replies.delete(receipt)
    }
  }

  /** Remove transient authority and settle reply observation for one disposed exact Agent. */
  private invalidateAgentRecords(agent: Agent): void {
    for (const [handle, record] of this.targetReferences) {
      if (record.callerAgent === agent || record.targetAgent === agent) this.targetReferences.delete(handle)
    }
    for (const [handle, record] of this.selections) {
      if (record.callerAgent === agent || record.targetAgent === agent) this.selections.delete(handle)
    }
    for (const record of [...this.replies.values()]) {
      if (record.callerAgent === agent) {
        this.rejectReply(record, new FleetError(
          'fleet-caller-unavailable',
          'fleet-caller-unavailable: the owning Fleet session is no longer the exact live Agent.',
        ))
      } else if (record.targetAgent === agent && record.result === undefined) {
        this.settleReply(record, {
          ...this.replyResultBase(record),
          outcome: 'target-unavailable',
          ...(record.turn === undefined ? {} : { turn: record.turn }),
          admitted: record.admitted,
        })
      }
    }
  }

  /** Enforce self-target and delegated-write policy before any Agent method call. */
  private requireWritableRoot(sessionId: string, options: FleetCallerOptions): Agent {
    if (options.callerSessionId === sessionId) {
      throw new FleetError('fleet-self-target', `fleet-self-target: session "${sessionId}" cannot control itself`)
    }
    const agent = this.requireAgent(sessionId)
    if (this.classifyLive(agent) === 'root') return agent
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
    const originalText = extractText(message.content)
    const textTruncated = originalText.length > this.config.maxMessageTextChars
    const text = originalText.slice(0, this.config.maxMessageTextChars)
    const relay = getRelayView(message)
    return { messageId: message.id, role: message.role, text, textTruncated, ...(relay === undefined ? {} : { relay }) }
  }

  /** Classify one live event subject and deliver its projected lifecycle event. */
  private publishLive(type: Exclude<FleetEventType, 'disposed'>, agent: Agent): void {
    if (!this.active) return
    const kind = this.classifyLive(agent)
    this.deliver({ type, agent: this.project(agent, kind) })
  }

  /** Project disposal from the exact Agent cache after registry removal. */
  private publishDisposed(agent: Agent): void {
    if (!this.active) return
    const kind = this.runtimeKinds.get(agent)
    if (kind === undefined) {
      // Provider seeding and agent/created must cache every exact Agent before its paired disposal.
      throw new Error(`dsh-supervisor: missing runtime ownership classification for disposed agent "${agent.id}"`)
    }
    const event: FleetEvent = { type: 'disposed', agent: this.project(agent, kind) }
    this.runtimeKinds.delete(agent)
    this.invalidateAgentRecords(agent)
    this.deliver(event)
  }

  /** Deliver one projected lifecycle event without letting subscribers disrupt Agent lifecycle. */
  private deliver(event: FleetEvent): void {
    const { type, agent } = event
    for (const listener of [...this.listeners]) {
      try {
        const returned = listener(event)
        void Promise.resolve(returned).catch((error) => {
          this.ctx.logger.warn(`fleet "${agent.sessionId}": ${type} listener rejected: ${String(error)}`)
        })
      } catch (error) {
        this.ctx.logger.warn(`fleet "${agent.sessionId}": ${type} listener threw: ${String(error)}`)
      }
    }
  }
}

/** Build the exact model-facing message required by Fleet root writes. */
function createToken(prefix: string, records: { has(value: string): boolean }): string {
  let token: string
  do {
    token = `${prefix}${randomBytes(12).toString('base64url')}`
  } while (records.has(token))
  return token
}

function invalidTargetReference(): FleetError {
  return new FleetError(
    'fleet-target-reference-invalid',
    'fleet-target-reference-invalid: the target reference is invalid or no longer usable. '
      + 'No action was taken. Do not substitute another Fleet session. Relist or ask the user.',
  )
}

function invalidSelection(): FleetError {
  return new FleetError(
    'fleet-selection-invalid',
    'fleet-selection-invalid: the selection handle is invalid or no longer usable. '
      + 'No action was taken. Do not substitute another Fleet session. Relist or ask the user.',
  )
}

function invalidReply(): FleetError {
  return new FleetError(
    'fleet-reply-invalid',
    'fleet-reply-invalid: the reply receipt is invalid or no longer observable. '
      + 'No target action was taken. Do not substitute another Fleet delivery.',
  )
}

function createFleetMessage(text: string) {
  validateMessageText(text)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-supervisor' },
  })
}

function createFleetRelayMessage(text: string, caller: Agent): UserMessage {
  validateMessageText(text)
  const deliveryId = `fd_${randomBytes(12).toString('base64url')}` as FleetDeliveryId
  const senderSessionId = caller.id
  const encodedSender = encodeURIComponent(senderSessionId)
  const encodedDelivery = encodeURIComponent(deliveryId)
  return createUserMessage({
    content: [
      { type: 'text', text: `Fleet relay from session ${encodedSender} (delivery ${encodedDelivery}):\n[untrusted body begins]\n` },
      { type: 'text', text },
    ],
    source: { kind: 'fleet-relay', version: 1, form: 'relay', senderSessionId, deliveryId },
  })
}

function validateMessageText(text: string): void {
  if (text.trim().length === 0) {
    throw new FleetError('fleet-empty-text', 'fleet-empty-text: message text must not be empty')
  }
}

function relaySource(message: UserMessage): { deliveryId: FleetDeliveryId } {
  if (message.source.kind !== 'fleet-relay') throw new Error('dsh-supervisor: missing Fleet relay source')
  return message.source
}

function getRelayView(message: Message): FleetRelayView | undefined {
  const source = parseFleetRelaySource(message.source)
  if (source === undefined) return undefined
  return {
    version: source.version,
    form: source.form,
    senderSessionId: source.senderSessionId,
    deliveryId: source.deliveryId,
  }
}

/** Keep only the user and assistant roles promised by Fleet inspect. */
function isSummarizableMessage(message: Message): message is Message & { role: 'user' | 'assistant' } {
  if (message.role === 'assistant') return true
  return message.role === 'user' && message.source.kind !== 'tool'
}

/** Flatten visible text blocks without exposing tool arguments or raw events. */
function extractText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}
