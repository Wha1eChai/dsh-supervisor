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
  title: { type: 'string' },
  parentSessionId: { type: 'string' },
  cwd: { type: 'string' },
  blank: { type: 'boolean', required: true },
  queueCount: { type: 'integer', required: true },
  updatedAt: { type: 'number' },
} as const

const FLEET_TARGET_PROPERTIES = {
  ...FLEET_AGENT_PROPERTIES,
  targetRef: { type: 'string', required: true },
  targetRefExpiresAt: { type: 'number', required: true },
} as const

const FLEET_MESSAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    role: { type: 'string', enum: ['user', 'assistant'], required: true },
    text: { type: 'string', required: true },
    textTruncated: { type: 'boolean', required: true },
    relay: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', const: 1, required: true },
        form: { type: 'string', enum: ['relay'], required: true },
        senderSessionId: { type: 'string', required: true },
        deliveryId: { type: 'string', required: true },
      },
    },
  },
} as const

const FLEET_INSPECT_AGENT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...FLEET_AGENT_PROPERTIES,
    omittedMessages: { type: 'integer', required: true },
    tailMessages: {
      type: 'array',
      items: FLEET_MESSAGE_VALUE_SCHEMA,
      required: true,
    },
  },
} as const

const FLEET_INSPECT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agent: { ...FLEET_INSPECT_AGENT_VALUE_SCHEMA, required: true },
    selection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        handle: { type: 'string', required: true },
        expiresAt: { type: 'number', required: true },
      },
    },
  },
} as const

const FLEET_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: FLEET_TARGET_PROPERTIES,
      },
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
    deliveryId: { type: 'string', required: true },
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

/** Parse one byte-exact opaque Fleet handle without normalizing replayed data. */
function parseHandle(value: string): string | undefined {
  return value.length === 0 || value !== value.trim() ? undefined : value
}

/** Require one byte-exact opaque Fleet handle. */
function handle(value: string, field: 'target_ref' | 'selection_handle'): string {
  const parsed = parseHandle(value)
  if (parsed === undefined) {
    throw new TypeError(`${field} must be a non-empty exact handle without surrounding whitespace`)
  }
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
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('fleet_list requires an owning agent session')
        const agents = ctx.fleet.listTargets({
          callerSessionId: exec.agent.session.id,
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
        target_ref: { type: 'string', required: true, description: 'Caller-bound target reference from fleet_list.' },
        tail_messages: { type: 'number', description: 'Optional positive safe-integer transcript tail size.' },
      },
      output: {
        schema: FLEET_INSPECT_VALUE_SCHEMA,
        render: (_args, value) => [{
          type: 'text',
          text: `Fleet session ${value.agent.sessionId} is ${value.agent.status} with ${value.agent.control} control. ${value.selection === undefined ? 'No write selection was issued.' : `Write selection ${value.selection.handle} expires at ${value.selection.expiresAt}.`} Summary: ${json(value.agent)}`,
        }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('fleet_inspect requires an owning agent session')
        const targetRef = handle(args.target_ref, 'target_ref')
        const tail = tailMessages(args.tail_messages)
        return ctx.fleet.inspectTarget(targetRef, {
          callerSessionId: exec.agent.session.id,
          ...(tail === undefined ? {} : { tailMessages: tail }),
        })
      },
      presentCall: args => {
        const targetRef = parseHandle(args.target_ref)
        if (targetRef === undefined) return undefined
        if (args.tail_messages !== undefined && !validTailMessages(args.tail_messages)) return undefined
        return present(
          `Inspect Fleet target ${targetRef}`,
          'search',
          args.tail_messages === undefined
            ? { targetRef }
            : { targetRef, tailMessages: args.tail_messages },
        )
      },
    }))

    if (config.controlMode !== 'read-only') {
      yield ctx.tools.register(defineTool({
        name: 'fleet_send',
        description: 'Queue a follow-up message for a live root Fleet session.',
        parameters: {
          selection_handle: { type: 'string', required: true, description: 'Single-attempt selection from fleet_inspect.' },
          text: { type: 'string', required: true, description: 'Follow-up message text.' },
        },
        output: {
          schema: FLEET_WRITE_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Queued follow-up ${value.messageId} for confirmed Fleet session ${value.sessionId}. Delivery ${value.deliveryId}.`
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_send requires an owning agent session')
          const selectionHandle = handle(args.selection_handle, 'selection_handle')
          requireText(args.text)
          return ctx.fleet.sendSelected(selectionHandle, args.text, {
            callerSessionId: exec.agent.session.id,
          })
        },
        presentCall: args => {
          const selectionHandle = parseHandle(args.selection_handle)
          if (selectionHandle === undefined || args.text.trim().length === 0) return undefined
          return present(
            'Send message to confirmed Fleet target',
            'execute',
            { selectionHandle },
          )
        },
      }))

      yield ctx.tools.register(defineTool({
        name: 'fleet_steer',
        description: 'Submit a steering message to a live root Fleet session.',
        parameters: {
          selection_handle: { type: 'string', required: true, description: 'Single-attempt selection from fleet_inspect.' },
          text: { type: 'string', required: true, description: 'Steering message text.' },
        },
        output: {
          schema: FLEET_WRITE_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Submitted steering message ${value.messageId} for confirmed Fleet session ${value.sessionId}. Delivery ${value.deliveryId}.`
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_steer requires an owning agent session')
          const selectionHandle = handle(args.selection_handle, 'selection_handle')
          requireText(args.text)
          return ctx.fleet.steerSelected(selectionHandle, args.text, {
            callerSessionId: exec.agent.session.id,
          })
        },
        presentCall: args => {
          const selectionHandle = parseHandle(args.selection_handle)
          if (selectionHandle === undefined || args.text.trim().length === 0) return undefined
          return present(
            'Steer confirmed Fleet target',
            'execute',
            { selectionHandle },
          )
        },
      }))
    }

    if (config.controlMode === 'full') {
      yield ctx.tools.register(defineTool({
        name: 'fleet_cancel',
        description: 'Cancel active work in a live root Fleet session.',
        parameters: {
          selection_handle: { type: 'string', required: true, description: 'Single-attempt selection from fleet_inspect.' },
          keep_inbox: { type: 'boolean', description: 'Preserve queued messages while canceling active work.' },
        },
        output: {
          schema: FLEET_CANCEL_VALUE_SCHEMA,
          render: (_args, value) => [{
            type: 'text',
            text: `Cancellation accepted for confirmed Fleet session ${value.sessionId}.`,
          }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          if (exec.agent === undefined) throw new Error('fleet_cancel requires an owning agent session')
          const selectionHandle = handle(args.selection_handle, 'selection_handle')
          return ctx.fleet.cancelSelected(selectionHandle, {
            callerSessionId: exec.agent.session.id,
            ...(args.keep_inbox === undefined ? {} : { keepInbox: args.keep_inbox }),
          })
        },
        presentCall: args => {
          const selectionHandle = parseHandle(args.selection_handle)
          return selectionHandle === undefined
            ? undefined
            : present(
              'Cancel confirmed Fleet target',
              'execute',
              { selectionHandle },
            )
        },
      }))
    }
  }, 'fleet.tools()')
}
