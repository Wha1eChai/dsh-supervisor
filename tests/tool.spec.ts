import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { FleetService } from '../src/service.js'
import { FleetError } from '../src/types.js'
import type {
  FleetAgentView,
  FleetInspectOptions,
  FleetInspectView,
  FleetListFilter,
} from '../src/types.js'
import * as toolPlugin from '../src/tool.js'

const TOOL_NAMES = ['fleet_list', 'fleet_inspect', 'fleet_send', 'fleet_steer', 'fleet_cancel'] as const
const RUNNING_ROOT: FleetAgentView = {
  sessionId: 'target',
  status: 'running',
  kind: 'root',
  control: 'direct',
  cwd: 'D:/work',
  blank: false,
  queueCount: 2,
  updatedAt: 123,
}
const DELEGATED: FleetAgentView = {
  sessionId: 'child',
  status: 'idle',
  kind: 'delegated',
  control: 'subagent',
  parentSessionId: 'parent',
  blank: true,
  queueCount: 0,
}

interface FleetCalls {
  list: FleetListFilter[]
  inspect: Array<[string, FleetInspectOptions]>
  send: Array<[string, string, { callerSessionId?: string }]>
  steer: Array<[string, string, { callerSessionId?: string }]>
  cancel: Array<[string, { callerSessionId?: string; keepInbox?: boolean }]>
}

class RecordingFleet extends FleetService {
  readonly calls: FleetCalls = { list: [], inspect: [], send: [], steer: [], cancel: [] }
  listValue: FleetAgentView[] = []
  inspectValue: FleetInspectView = { ...RUNNING_ROOT, tailMessages: [] }
  badListOutput: 'extra' | 'type' | undefined

  constructor(ctx: Context) {
    super(ctx)
  }

  list(filter: FleetListFilter = {}): FleetAgentView[] {
    this.calls.list.push(filter)
    if (this.badListOutput === 'extra') {
      return [{ ...RUNNING_ROOT, unexpected: true } as FleetAgentView]
    }
    if (this.badListOutput === 'type') {
      return [{ ...RUNNING_ROOT, queueCount: 'two' } as unknown as FleetAgentView]
    }
    return this.listValue
  }

  inspect(sessionId: string, options: FleetInspectOptions = {}): FleetInspectView {
    this.calls.inspect.push([sessionId, options])
    return this.inspectValue
  }

  send(sessionId: string, text: string, options: { callerSessionId?: string } = {}): { messageId: string } {
    this.calls.send.push([sessionId, text, options])
    if (sessionId === options.callerSessionId) {
      throw new FleetError('fleet-self-target', `fleet-self-target: session "${sessionId}" cannot control itself`)
    }
    if (sessionId === 'child') {
      throw new FleetError(
        'fleet-delegated-write-deferred',
        `fleet-delegated-write-deferred: delegated writes are deferred for session "${sessionId}"`,
      )
    }
    return { messageId: 'send-message' }
  }

  steer(sessionId: string, text: string, options: { callerSessionId?: string } = {}): { messageId: string } {
    this.calls.steer.push([sessionId, text, options])
    if (sessionId === options.callerSessionId) {
      throw new FleetError('fleet-self-target', `fleet-self-target: session "${sessionId}" cannot control itself`)
    }
    if (sessionId === 'child') {
      throw new FleetError(
        'fleet-delegated-write-deferred',
        `fleet-delegated-write-deferred: delegated writes are deferred for session "${sessionId}"`,
      )
    }
    return { messageId: 'steer-message' }
  }

  cancel(
    sessionId: string,
    options: { callerSessionId?: string; keepInbox?: boolean } = {},
  ): { accepted: true } {
    this.calls.cancel.push([sessionId, options])
    return { accepted: true }
  }

  subscribe(): () => void {
    return () => {}
  }
}

const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()?.fiber.dispose()
})

async function harness(mode: toolPlugin.Config['controlMode'] = 'full') {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RecordingFleet)
  const fiber = await ctx.plugin(toolPlugin, { controlMode: mode })
  const fleet = ctx.fleet as RecordingFleet
  return { ctx, fiber, fleet }
}

function fakeAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  return { session } as Agent
}

function call(
  ctx: Context,
  name: string,
  arguments_: unknown,
  options: { agent?: Agent; signal?: AbortSignal } = {},
): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    callId: CallId(`call-${name}-${Math.random()}`),
    name,
    arguments: arguments_,
    signal: options.signal ?? new AbortController().signal,
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  })
}

function success(result: ToolExecutionResult): Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error(result.error.message)
  return result
}

function text(result: ToolExecutionResult): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected one text result')
  return block.text
}

function registered(ctx: Context): string[] {
  return TOOL_NAMES.filter(name => ctx.tools.get(name) !== undefined)
}

function parameterSchema(
  properties: NonNullable<ToolSchema['parameters']['properties']>,
  required: string[] = [],
): ToolSchema['parameters'] {
  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
  }
}

function expectExplicitObjectsClosed(node: unknown): void {
  if (typeof node !== 'object' || node === null) return
  const record = node as Record<string, unknown>
  if (record['type'] === 'object') {
    expect(record['additionalProperties']).toBe(false)
    const properties = record['properties']
    if (typeof properties === 'object' && properties !== null) {
      for (const property of Object.values(properties)) expectExplicitObjectsClosed(property)
    }
  }
  if (record['type'] === 'array') expectExplicitObjectsClosed(record['items'])
  if (Array.isArray(record['oneOf'])) {
    for (const branch of record['oneOf']) expectExplicitObjectsClosed(branch)
  }
}

describe('Fleet tool namespace and configuration', () => {
  it('1. keeps the Loader-safe named namespace entry with no default export', () => {
    expect('default' in toolPlugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolPlugin) as Record<string, unknown>
    expect(unwrapped).toBe(toolPlugin)
    expect(unwrapped.name).toBe('tool-dsh-supervisor')
    expect(unwrapped.inject).toEqual(['tools', 'fleet'])
    expect(new Set(toolPlugin.inject)).toEqual(new Set(['tools', 'fleet']))
    expect(toolPlugin.inject).toHaveLength(2)
    expect(unwrapped.Config).toBe(toolPlugin.Config)
    expect(unwrapped.apply).toBe(toolPlugin.apply)
    expect(toolPlugin.Config()).toEqual({ controlMode: 'read-only' })
    expect(() => toolPlugin.Config({ controlMode: 'invalid' } as never)).toThrow()

    const regressed = { ...toolPlugin, default: toolPlugin.apply }
    expect(loader.unwrapExports(regressed)).toBe(toolPlugin.apply)
    expect(loader.unwrapExports(regressed)).not.toMatchObject({
      inject: ['tools', 'fleet'],
      Config: toolPlugin.Config,
    })
  })

  it('2. registers the exact tool set and parameter schema for each control mode', async () => {
    const readOnly = await harness('read-only')
    expect(registered(readOnly.ctx)).toEqual(['fleet_list', 'fleet_inspect'])

    const message = await harness('message')
    expect(registered(message.ctx)).toEqual(['fleet_list', 'fleet_inspect', 'fleet_send', 'fleet_steer'])

    const full = await harness('full')
    expect(registered(full.ctx)).toEqual([...TOOL_NAMES])
    const schemas = new Map(full.ctx.tools.schemas().map(schema => [schema.name, schema]))
    expect(schemas.get('fleet_list')?.parameters).toEqual(parameterSchema({
      roots_only: { type: 'boolean', description: 'Return only root sessions.' },
      running_only: { type: 'boolean', description: 'Return only running sessions.' },
    }))
    expect(schemas.get('fleet_inspect')?.parameters).toEqual(parameterSchema({
      session_id: { type: 'string', description: 'Target Fleet session id.' },
      tail_messages: { type: 'number', description: 'Optional positive safe-integer transcript tail size.' },
    }, ['session_id']))
    expect(schemas.get('fleet_send')?.parameters).toEqual(parameterSchema({
      session_id: { type: 'string', description: 'Target Fleet session id.' },
      text: { type: 'string', description: 'Follow-up message text.' },
    }, ['session_id', 'text']))
    expect(schemas.get('fleet_steer')?.parameters).toEqual(parameterSchema({
      session_id: { type: 'string', description: 'Target Fleet session id.' },
      text: { type: 'string', description: 'Steering message text.' },
    }, ['session_id', 'text']))
    expect(schemas.get('fleet_cancel')?.parameters).toEqual(parameterSchema({
      session_id: { type: 'string', description: 'Target Fleet session id.' },
      keep_inbox: { type: 'boolean', description: 'Preserve queued messages while canceling active work.' },
    }, ['session_id']))
    for (const schema of schemas.values()) {
      expect(Object.keys(schema.parameters.properties ?? {})).not.toContain('callerSessionId')
      expect(Object.keys(schema.parameters.properties ?? {})).not.toContain('caller_session_id')
    }
  })

  it('3. removes every registered tool on HMR and unload', async () => {
    for (const mode of ['read-only', 'message', 'full'] as const) {
      const { ctx, fiber } = await harness(mode)
      expect(registered(ctx).length).toBe(mode === 'read-only' ? 2 : mode === 'message' ? 4 : 5)
      await fiber.dispose()
      expect(registered(ctx)).toEqual([])
    }

    const { ctx, fiber } = await harness('full')
    await fiber.update({ controlMode: 'read-only' })
    expect(registered(ctx)).toEqual(['fleet_list', 'fleet_inspect'])
    await fiber.update({ controlMode: 'message' })
    expect(registered(ctx)).toEqual(['fleet_list', 'fleet_inspect', 'fleet_send', 'fleet_steer'])
    await fiber.update({ controlMode: 'full' })
    expect(registered(ctx)).toEqual([...TOOL_NAMES])
  })
})

describe('Fleet read tools', () => {
  it('4. maps list filters and returns canonical empty/non-empty values, render text, and card intent', async () => {
    const { ctx, fleet } = await harness()

    const empty = success(await call(ctx, 'fleet_list', { roots_only: true, running_only: false }))
    expect(fleet.calls.list).toEqual([{ rootsOnly: true, runningOnly: false }])
    expect(empty.value).toEqual({ agents: [], count: 0 })
    expect(text(empty)).toBe('No live Fleet sessions.')

    fleet.listValue = [RUNNING_ROOT, DELEGATED]
    const populated = success(await call(ctx, 'fleet_list', {}))
    expect(fleet.calls.list.at(-1)).toEqual({})
    expect(populated.value).toEqual({ agents: [RUNNING_ROOT, DELEGATED], count: 2 })
    expect(text(populated)).toBe(`Found 2 live Fleet sessions: ${JSON.stringify([RUNNING_ROOT, DELEGATED])}`)
    expect(ctx.tools.get('fleet_list')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'List Fleet sessions', kind: 'search',
    })
  })

  it('5. maps inspect arguments, validates tail size before Fleet, and renders complete output and card data', async () => {
    const { ctx, fleet } = await harness()
    fleet.inspectValue = {
      ...RUNNING_ROOT,
      tailMessages: [
        { messageId: 'user-1', role: 'user', text: 'question' },
        { messageId: 'assistant-1', role: 'assistant', text: 'answer' },
      ],
    }

    const result = success(await call(ctx, 'fleet_inspect', { session_id: ' target ', tail_messages: 2 }))
    expect(fleet.calls.inspect).toEqual([['target', { tailMessages: 2 }]])
    expect(result.value).toEqual(fleet.inspectValue)
    expect(text(result)).toBe(
      `Fleet session target is running with direct control. Summary: ${JSON.stringify(fleet.inspectValue)}`,
    )
    expect(ctx.tools.get('fleet_inspect')?.presentCall?.({ session_id: ' target ', tail_messages: 2 })).toEqual({
      card: 'generic',
      title: 'Inspect Fleet session target',
      kind: 'search',
      rawInput: { sessionId: 'target', tailMessages: 2 },
    })
    expect(ctx.tools.get('fleet_inspect')?.presentCall?.({ session_id: 'target' })).toEqual({
      card: 'generic',
      title: 'Inspect Fleet session target',
      kind: 'search',
      rawInput: { sessionId: 'target' },
    })

    const withoutTail = success(await call(ctx, 'fleet_inspect', { session_id: 'target' }))
    expect(fleet.calls.inspect.at(-1)).toEqual(['target', {}])
    expect(withoutTail.value).toEqual(fleet.inspectValue)

    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const before = fleet.calls.inspect.length
      const failed = await call(ctx, 'fleet_inspect', { session_id: 'target', tail_messages: invalid })
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain('tail_messages must be a positive safe integer')
      expect(fleet.calls.inspect).toHaveLength(before)
    }
  })

  it.each([
    ['fleet_inspect', [
      { session_id: '   ' },
      { session_id: 'target', tail_messages: 0 },
      { session_id: 'target', tail_messages: 1.5 },
    ]],
    ['fleet_send', [
      { session_id: '   ', text: 'message' },
      { session_id: 'target', text: ' \n ' },
    ]],
    ['fleet_steer', [
      { session_id: '\t', text: 'message' },
      { session_id: 'target', text: '\t' },
    ]],
    ['fleet_cancel', [{ session_id: '\n' }]],
  ] as const)('5b. makes %s fall back to a generic replay card for semantic invalidity', async (name, argsList) => {
    const { ctx } = await harness()
    for (const args of argsList) {
      expect(ctx.tools.get(name)?.presentCall?.(args)).toBeUndefined()
    }
  })
})

describe('Fleet write tools', () => {
  it('6. maps send/steer target, original text, and caller identity; Service policy failures stay isError', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')

    const sent = success(await call(ctx, 'fleet_send', { session_id: ' target ', text: '  keep spacing  ' }, { agent: owner }))
    expect(fleet.calls.send).toEqual([['target', '  keep spacing  ', { callerSessionId: 'caller' }]])
    expect(sent.value).toEqual({ sessionId: 'target', messageId: 'send-message' })
    expect(text(sent)).toBe('Queued follow-up send-message for Fleet session target.')
    expect(ctx.tools.get('fleet_send')?.presentCall?.({ session_id: ' target ', text: 'secret body' })).toEqual({
      card: 'generic', title: 'Send message to Fleet session target', kind: 'execute',
    })

    const steered = success(await call(ctx, 'fleet_steer', { session_id: 'target', text: 'turn left' }, { agent: owner }))
    expect(fleet.calls.steer).toEqual([['target', 'turn left', { callerSessionId: 'caller' }]])
    expect(steered.value).toEqual({ sessionId: 'target', messageId: 'steer-message' })
    expect(text(steered)).toBe('Submitted steering message steer-message for Fleet session target.')
    expect(ctx.tools.get('fleet_steer')?.presentCall?.({ session_id: 'target', text: 'secret body' })).toEqual({
      card: 'generic', title: 'Steer Fleet session target', kind: 'execute',
    })

    const selfSend = await call(ctx, 'fleet_send', { session_id: 'caller', text: 'x' }, { agent: owner })
    expect(selfSend.isError).toBe(true)
    expect(text(selfSend)).toContain('fleet-self-target')
    expect(selfSend.isError && selfSend.error.message).toContain('fleet-self-target')

    const selfSteer = await call(ctx, 'fleet_steer', { session_id: 'caller', text: 'x' }, { agent: owner })
    expect(selfSteer.isError).toBe(true)
    expect(text(selfSteer)).toContain('fleet-self-target')

    const delegatedSend = await call(ctx, 'fleet_send', { session_id: 'child', text: 'x' }, { agent: owner })
    expect(delegatedSend.isError).toBe(true)
    expect(text(delegatedSend)).toContain('fleet-delegated-write-deferred')

    const delegatedSteer = await call(ctx, 'fleet_steer', { session_id: 'child', text: 'x' }, { agent: owner })
    expect(delegatedSteer.isError).toBe(true)
    expect(text(delegatedSteer)).toContain('fleet-delegated-write-deferred')
  })

  it('7. rejects agentless and invalid writes before every Fleet call', async () => {
    const { ctx, fleet } = await harness()
    const attempts = [
      ['fleet_send', { session_id: 'target', text: 'x' }, 'fleet_send requires an owning agent session'],
      ['fleet_steer', { session_id: 'target', text: 'x' }, 'fleet_steer requires an owning agent session'],
      ['fleet_cancel', { session_id: 'target' }, 'fleet_cancel requires an owning agent session'],
    ] as const

    for (const [name, args, message] of attempts) {
      const failed = await call(ctx, name, args)
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain(message)
    }

    const owner = fakeAgent('caller')
    for (const [name, args, message] of [
      ['fleet_send', { session_id: ' ', text: 'x' }, 'session_id must not be empty'],
      ['fleet_send', { session_id: 'target', text: ' \n ' }, 'text must not be empty'],
      ['fleet_steer', { session_id: '', text: 'x' }, 'session_id must not be empty'],
      ['fleet_steer', { session_id: 'target', text: '\t' }, 'text must not be empty'],
      ['fleet_cancel', { session_id: ' ' }, 'session_id must not be empty'],
    ] as const) {
      const failed = await call(ctx, name, args, { agent: owner })
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain(message)
    }
    expect(fleet.calls.send).toEqual([])
    expect(fleet.calls.steer).toEqual([])
    expect(fleet.calls.cancel).toEqual([])
  })

  it('8. maps cancel caller and optional keepInbox without inventing a default', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')

    const omitted = success(await call(ctx, 'fleet_cancel', { session_id: ' target ' }, { agent: owner }))
    const supplied = success(await call(ctx, 'fleet_cancel', {
      session_id: 'target', keep_inbox: false,
    }, { agent: owner }))

    expect(fleet.calls.cancel).toEqual([
      ['target', { callerSessionId: 'caller' }],
      ['target', { callerSessionId: 'caller', keepInbox: false }],
    ])
    expect(omitted.value).toEqual({ sessionId: 'target', accepted: true })
    expect(supplied.value).toEqual({ sessionId: 'target', accepted: true })
    expect(text(omitted)).toBe('Cancellation accepted for Fleet session target.')
    expect(ctx.tools.get('fleet_cancel')?.presentCall?.({ session_id: ' target ' })).toEqual({
      card: 'generic', title: 'Cancel Fleet session target', kind: 'execute',
    })
  })
})

describe('Fleet tool execution policy and schemas', () => {
  it('9. classifies list/inspect as parallel and valid writes as exclusive', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.executionMode({
      callId: CallId('mode-list'), name: 'fleet_list', arguments: {}, signal: new AbortController().signal,
    })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({
      callId: CallId('mode-inspect'), name: 'fleet_inspect', arguments: { session_id: 'target' },
      signal: new AbortController().signal,
    })).toEqual({ kind: 'parallel' })
    for (const [name, args] of [
      ['fleet_send', { session_id: 'target', text: 'message' }],
      ['fleet_steer', { session_id: 'target', text: 'direction' }],
      ['fleet_cancel', { session_id: 'target' }],
    ] as const) {
      expect(ctx.tools.executionMode({
        callId: CallId(`mode-${name}`), name, arguments: args, signal: new AbortController().signal,
      })).toEqual({ kind: 'exclusive' })
    }
  })

  it('10. invokes each write body abort guard through the real ToolRuntime', async () => {
    const { ctx } = await harness()
    const owner = fakeAgent('caller')

    for (const [name, args] of [
      ['fleet_send', { session_id: 'target', text: 'message' }],
      ['fleet_steer', { session_id: 'target', text: 'direction' }],
      ['fleet_cancel', { session_id: 'target' }],
    ] as const) {
      const controller = new AbortController()
      const throwIfAborted = vi.spyOn(controller.signal, 'throwIfAborted')
      success(await call(ctx, name, args, { agent: owner, signal: controller.signal }))
      expect(throwIfAborted).toHaveBeenCalledOnce()
    }
  })

  it('10b. rejects native pre-aborted write calls with zero Fleet calls', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))

    for (const [name, args] of [
      ['fleet_send', { session_id: 'target', text: 'x' }],
      ['fleet_steer', { session_id: 'target', text: 'x' }],
      ['fleet_cancel', { session_id: 'target' }],
    ] as const) {
      const failed = await call(ctx, name, args, { agent: owner, signal: controller.signal })
      expect(failed.isError).toBe(true)
      expect(failed.isError && failed.error.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    }
    expect(fleet.calls.send).toEqual([])
    expect(fleet.calls.steer).toEqual([])
    expect(fleet.calls.cancel).toEqual([])
  })

  it('10c. reflects rc.6 late cancellation after synchronous Fleet acceptance', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')
    const controller = new AbortController()
    ctx.on('tools/execute', async (_exec, next) => {
      const accepted = await next()
      controller.abort(new Error('cancelled after Fleet acceptance'))
      return accepted
    })

    const result = await call(ctx, 'fleet_send', {
      session_id: 'target', text: 'message',
    }, { agent: owner, signal: controller.signal })

    expect(fleet.calls.send).toEqual([['target', 'message', { callerSessionId: 'caller' }]])
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      isError: true,
      error: { info: { name: 'AbortError', code: 'ABORTED' } },
    })
  })

  it('11. preserves every canonical value through JSON and rejects invalid provider output', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')
    fleet.listValue = [RUNNING_ROOT, DELEGATED]
    fleet.inspectValue = {
      ...DELEGATED,
      tailMessages: [{ messageId: 'message', role: 'assistant', text: 'done' }],
    }

    const successes = [
      await call(ctx, 'fleet_list', {}),
      await call(ctx, 'fleet_inspect', { session_id: 'child' }),
      await call(ctx, 'fleet_send', { session_id: 'target', text: 'x' }, { agent: owner }),
      await call(ctx, 'fleet_steer', { session_id: 'target', text: 'x' }, { agent: owner }),
      await call(ctx, 'fleet_cancel', { session_id: 'target' }, { agent: owner }),
    ].map(success)
    for (const result of successes) {
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
    }

    for (const name of TOOL_NAMES) {
      const definition = ctx.tools.get(name)
      if (definition === undefined) throw new Error(`missing ${name}`)
      expectExplicitObjectsClosed(definition.output.schema)
    }

    fleet.badListOutput = 'extra'
    const extra = await call(ctx, 'fleet_list', {})
    expect(extra.isError).toBe(true)
    expect(extra.isError && extra.error.info?.name).toBe('ToolOutputError')
    expect(text(extra)).toContain('unexpected')

    fleet.badListOutput = 'type'
    const wrongType = await call(ctx, 'fleet_list', {})
    expect(wrongType.isError).toBe(true)
    expect(wrongType.isError && wrongType.error.info?.name).toBe('ToolOutputError')
    expect(text(wrongType)).toContain('queueCount')
  })

  it('12. keeps the Consumer source free of Agent/Subagent imports and direct registries', async () => {
    const source = await readFile(fileURLToPath(new URL('../src/tool.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/from ['"]@deepseek-ai\/dsh-agent(?:['"/])/)
    expect(source).not.toMatch(/from ['"]@deepseek-ai\/dsh-subagent(?:['"/])/)
    expect(source).not.toContain('ctx.agents')
    expect(source).not.toContain('ctx.sessions')
    expect(source).not.toContain('ctx.subagents')
    expect(source).not.toContain('callerSessionId: args')
    expect(source.match(/callerSessionId: exec\.agent\.session\.id/g)).toHaveLength(3)
  })
})
