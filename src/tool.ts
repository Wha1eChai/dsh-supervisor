/**
 * Model-facing Fleet tool Consumer over the replaceable `ctx.fleet` service.
 * @module @wha1echai/dsh-supervisor/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-dsh-supervisor'
export const inject = ['tools', 'fleet']

/** Deployment-level visibility for model-callable Fleet control tools. */
export interface Config {
  controlMode: 'read-only' | 'message' | 'full'
}

/** Schemastery validation and the read-only default for Fleet tool visibility. */
export const Config: Schema<Config> = Schema.object({
  controlMode: Schema.union(['read-only', 'message', 'full']).default('read-only'),
})

const FLEET_AGENT_PROPERTIES = {
  sessionId: { type: 'string', required: true },
  status: { type: 'string', enum: ['idle', 'running'], required: true },
  kind: { type: 'string', enum: ['root', 'delegated'], required: true },
  control: { type: 'string', enum: ['direct', 'subagent', 'observe-only'], required: true },
  parentSessionId: { type: 'string' },
  cwd: { type: 'string' },
  blank: { type: 'boolean', required: true },
  queueCount: { type: 'integer', required: true },
  updatedAt: { type: 'number' },
} as const

const FLEET_AGENT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: FLEET_AGENT_PROPERTIES,
} as const

const FLEET_MESSAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    role: { type: 'string', enum: ['user', 'assistant'], required: true },
    text: { type: 'string', required: true },
  },
} as const

const FLEET_INSPECT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...FLEET_AGENT_PROPERTIES,
    tailMessages: {
      type: 'array',
      items: FLEET_MESSAGE_VALUE_SCHEMA,
      required: true,
    },
  },
} as const

const FLEET_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agents: {
      type: 'array',
      items: FLEET_AGENT_VALUE_SCHEMA,
      required: true,
    },
    count: { type: 'integer', required: true },
  },
} as const

const FLEET_WRITE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    messageId: { type: 'string', required: true },
  },
} as const

const FLEET_CANCEL_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    accepted: { type: 'boolean', const: true, required: true },
  },
} as const

/** Parse a non-empty session id without throwing on replayed presentation data. */
function parseSessionId(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Require a non-empty session id while preserving its trimmed canonical form. */
function sessionId(value: string): string {
  const parsed = parseSessionId(value)
  if (parsed === undefined) throw new TypeError('session_id must not be empty')
  return parsed
}

/** Require a non-empty write payload without normalizing the text sent to Fleet. */
function requireText(value: string): void {
  if (value.trim().length === 0) throw new TypeError('text must not be empty')
}

/** Test an inspect tail bound not expressible by the tool schema DSL. */
function validTailMessages(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/** Validate an inspect tail bound not expressible by the tool schema DSL. */
function tailMessages(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!validTailMessages(value)) {
    throw new RangeError('tail_messages must be a positive safe integer')
  }
  return value
}

/** Generic pending card for Fleet calls. */
function present(
  title: string,
  kind: 'search' | 'execute',
  rawInput?: unknown,
): GenericCallView {
  return {
    card: 'generic',
    title,
    kind,
    ...(rawInput === undefined ? {} : { rawInput }),
  }
}

/** Stable JSON text used in model-facing Fleet read results. */
function json(value: unknown): string {
  return JSON.stringify(value)
}

/** Register the Fleet tools allowed by the deployment control mode. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(function* () {
    yield ctx.tools.register(defineTool({
      name: 'fleet_list',
      description: 'List live Fleet sessions in the current dsh process.',
      parameters: {
        roots_only: { type: 'boolean', description: 'Return only root sessions.' },
        running_only: { type: 'boolean', description: 'Return only running sessions.' },
      },
      output: {
        schema: FLEET_LIST_VALUE_SCHEMA,
        render: (_args, value) => [{
          type: 'text',
          text: value.count === 0
            ? 'No live Fleet sessions.'
            : `Found ${value.count} live Fleet session${value.count === 1 ? '' : 's'}: ${json(value.agents)}`,
        }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const agents = ctx.fleet.list({
          ...(args.roots_only === undefined ? {} : { rootsOnly: args.roots_only }),
          ...(args.running_only === undefined ? {} : { runningOnly: args.running_only }),
        })
        return { agents, count: agents.length }
      },
      presentCall: () => present('List Fleet sessions', 'search'),
    }))

    yield ctx.tools.register(defineTool({
      name: 'fleet_inspect',
      description: 'Inspect one live Fleet session and return its bounded transcript summary.',
      parameters: {
        session_id: { type: 'string', required: true, description: 'Target Fleet session id.' },
        tail_messages: { type: 'number', description: 'Optional positive safe-integer transcript tail size.' },
      },
      output: {
        schema: FLEET_INSPECT_VALUE_SCHEMA,
        render: (_args, value) => [{
          type: 'text',
          text: `Fleet session ${value.sessionId} is ${value.status} with ${value.control} control. Summary: ${json(value)}`,
        }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const target = sessionId(args.session_id)
        const tail = tailMessages(args.tail_messages)
        return ctx.fleet.inspect(target, tail === undefined ? {} : { tailMessages: tail })
      },
      presentCall: args => {
        const target = parseSessionId(args.session_id)
        if (target === undefined) return undefined
        if (args.tail_messages !== undefined && !validTailMessages(args.tail_messages)) return undefined
        return present(
          `Inspect Fleet session ${target}`,
          'search',
          args.tail_messages === undefined
            ? { sessionId: target }
            : { sessionId: target, tailMessages: args.tail_messages },
        )
      },
    }))

    if (config.controlMode !== 'read-only') {
      yield ctx.tools.register(defineTool({
        name: 'fleet_send',
        description: 'Queue a follow-up message for a live root Fleet session.',
        parameters: {
          session_id: { type: 'string', required: true, description: 'Target Fleet session id.' },
          text: { type: 'string', required: true, description: 'Follow-up message text.' },
        },
        output: {
          schema: FLEET_WRITE_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Queued follow-up ${value.messageId} for Fleet session ${value.sessionId}.`,
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_send requires an owning agent session')
          const target = sessionId(args.session_id)
          requireText(args.text)
          const result = ctx.fleet.send(target, args.text, {
            callerSessionId: exec.agent.session.id,
          })
          return { sessionId: target, messageId: result.messageId }
        },
        presentCall: args => {
          const target = parseSessionId(args.session_id)
          if (target === undefined || args.text.trim().length === 0) return undefined
          return present(`Send message to Fleet session ${target}`, 'execute')
        },
      }))

      yield ctx.tools.register(defineTool({
        name: 'fleet_steer',
        description: 'Submit a steering message to a live root Fleet session.',
        parameters: {
          session_id: { type: 'string', required: true, description: 'Target Fleet session id.' },
          text: { type: 'string', required: true, description: 'Steering message text.' },
        },
        output: {
          schema: FLEET_WRITE_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Submitted steering message ${value.messageId} for Fleet session ${value.sessionId}.`,
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_steer requires an owning agent session')
          const target = sessionId(args.session_id)
          requireText(args.text)
          const result = ctx.fleet.steer(target, args.text, {
            callerSessionId: exec.agent.session.id,
          })
          return { sessionId: target, messageId: result.messageId }
        },
        presentCall: args => {
          const target = parseSessionId(args.session_id)
          if (target === undefined || args.text.trim().length === 0) return undefined
          return present(`Steer Fleet session ${target}`, 'execute')
        },
      }))
    }

    if (config.controlMode === 'full') {
      yield ctx.tools.register(defineTool({
        name: 'fleet_cancel',
        description: 'Cancel active work in a live root Fleet session.',
        parameters: {
          session_id: { type: 'string', required: true, description: 'Target Fleet session id.' },
          keep_inbox: { type: 'boolean', description: 'Preserve queued messages while canceling active work.' },
        },
        output: {
          schema: FLEET_CANCEL_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Cancellation accepted for Fleet session ${value.sessionId}.`,
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_cancel requires an owning agent session')
          const target = sessionId(args.session_id)
          const result = ctx.fleet.cancel(target, {
            callerSessionId: exec.agent.session.id,
            ...(args.keep_inbox === undefined ? {} : { keepInbox: args.keep_inbox }),
          })
          return { sessionId: target, accepted: result.accepted }
        },
        presentCall: args => {
          const target = parseSessionId(args.session_id)
          return target === undefined
            ? undefined
            : present(`Cancel Fleet session ${target}`, 'execute')
        },
      }))
    }
  }, 'fleet.tools()')
}
