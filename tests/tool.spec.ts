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
  FleetDeliveryReceipt,
  FleetInspectOptions,
  FleetInspectView,
  FleetListFilter,
  FleetSelectedCancelOptions,
  FleetSelectedWriteOptions,
  FleetTargetInspectOptions,
  FleetTargetInspectView,
  FleetTargetListOptions,
  FleetTargetView,
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
  title: 'Build Fleet',
}
const DELEGATED: FleetAgentView = {
  sessionId: 'child',
  title: 'Child work',
  status: 'idle',
  kind: 'delegated',
  control: 'subagent',
  parentSessionId: 'parent',
  blank: true,
  queueCount: 0,
}
const RUNNING_TARGET: FleetTargetView = {
  ...RUNNING_ROOT,
  targetRef: 'ft_target',
  targetRefExpiresAt: 1_000,
}
const DELEGATED_TARGET: FleetTargetView = {
  ...DELEGATED,
  targetRef: 'ft_child',
  targetRefExpiresAt: 1_000,
}

interface FleetCalls {
  listTargets: FleetTargetListOptions[]
  inspectTarget: Array<[string, FleetTargetInspectOptions]>
  sendSelected: Array<[string, string, FleetSelectedWriteOptions]>
  steerSelected: Array<[string, string, FleetSelectedWriteOptions]>
  cancelSelected: Array<[string, FleetSelectedCancelOptions]>
}

class RecordingFleet extends FleetService {
  readonly calls: FleetCalls = {
    listTargets: [], inspectTarget: [], sendSelected: [], steerSelected: [], cancelSelected: [],
  }
  listValue: FleetTargetView[] = []
  inspectValue: FleetTargetInspectView = {
    agent: { ...RUNNING_ROOT, omittedMessages: 0, tailMessages: [] },
    selection: { handle: 'fs_target', expiresAt: 2_000 },
  }
  badListOutput: 'extra' | 'type' | undefined

  constructor(ctx: Context) {
    super(ctx)
  }

  list(_filter: FleetListFilter = {}): FleetAgentView[] {
    return this.listValue
  }

  inspect(_sessionId: string, _options: FleetInspectOptions = {}): FleetInspectView {
    return this.inspectValue.agent
  }

  send(_sessionId: string, _text: string): { messageId: string } {
    return { messageId: 'direct-send-message' }
  }

  steer(_sessionId: string, _text: string): { messageId: string } {
    return { messageId: 'direct-steer-message' }
  }

  cancel(): { accepted: true } {
    return { accepted: true }
  }

  listTargets(options: FleetTargetListOptions): FleetTargetView[] {
    this.calls.listTargets.push(options)
    if (this.badListOutput === 'extra') {
      return [{ ...RUNNING_TARGET, unexpected: true } as FleetTargetView]
    }
    if (this.badListOutput === 'type') {
      return [{ ...RUNNING_TARGET, queueCount: 'two' } as unknown as FleetTargetView]
    }
    return this.listValue
  }

  inspectTarget(targetRef: string, options: FleetTargetInspectOptions): FleetTargetInspectView {
    this.calls.inspectTarget.push([targetRef, options])
    return this.inspectValue
  }

  sendSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): FleetDeliveryReceipt {
    this.calls.sendSelected.push([selectionHandle, text, options])
    if (selectionHandle === 'fs_invalid') {
      throw new FleetError(
        'fleet-selection-invalid',
        'fleet-selection-invalid: No action was taken. Do not substitute another Fleet session.',
      )
    }
    return { sessionId: 'target', messageId: 'send-message', deliveryId: 'fd-send' as FleetDeliveryReceipt['deliveryId'] }
  }

  steerSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): FleetDeliveryReceipt {
    this.calls.steerSelected.push([selectionHandle, text, options])
    if (selectionHandle === 'fs_invalid') {
      throw new FleetError(
        'fleet-selection-invalid',
        'fleet-selection-invalid: No action was taken. Do not substitute another Fleet session.',
      )
    }
    return { sessionId: 'target', messageId: 'steer-message', deliveryId: 'fd-steer' as FleetDeliveryReceipt['deliveryId'] }
  }

  cancelSelected(
    selectionHandle: string,
    options: FleetSelectedCancelOptions,
  ): { sessionId: string; accepted: true } {
    this.calls.cancelSelected.push([selectionHandle, options])
    return { sessionId: 'target', accepted: true }
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
      target_ref: { type: 'string', description: 'Caller-bound target reference from fleet_list.' },
      tail_messages: { type: 'number', description: 'Optional positive safe-integer transcript tail size.' },
    }, ['target_ref']))
    expect(schemas.get('fleet_send')?.parameters).toEqual(parameterSchema({
      selection_handle: { type: 'string', description: 'Single-attempt selection from fleet_inspect.' },
      text: { type: 'string', description: 'Follow-up message text.' },
    }, ['selection_handle', 'text']))
    expect(schemas.get('fleet_steer')?.parameters).toEqual(parameterSchema({
      selection_handle: { type: 'string', description: 'Single-attempt selection from fleet_inspect.' },
      text: { type: 'string', description: 'Steering message text.' },
    }, ['selection_handle', 'text']))
    expect(schemas.get('fleet_cancel')?.parameters).toEqual(parameterSchema({
      selection_handle: { type: 'string', description: 'Single-attempt selection from fleet_inspect.' },
      keep_inbox: { type: 'boolean', description: 'Preserve queued messages while canceling active work.' },
    }, ['selection_handle']))
    for (const schema of schemas.values()) {
      expect(Object.keys(schema.parameters.properties ?? {})).not.toContain('callerSessionId')
      expect(Object.keys(schema.parameters.properties ?? {})).not.toContain('caller_session_id')
      if (schema.name !== 'fleet_list') {
        expect(Object.keys(schema.parameters.properties ?? {})).not.toContain('session_id')
      }
      for (const forbidden of ['caller_session_id', 'sender_session_id', 'target_session_id', 'title', 'relay']) {
        expect(Object.keys(schema.parameters.properties ?? {})).not.toContain(forbidden)
      }
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
    const owner = fakeAgent('caller')

    const empty = success(await call(ctx, 'fleet_list', {
      roots_only: true, running_only: false,
    }, { agent: owner }))
    expect(fleet.calls.listTargets).toEqual([{
      rootsOnly: true, runningOnly: false, callerAgent: owner, callerSessionId: 'caller',
    }])
    expect(empty.value).toEqual({ agents: [], count: 0 })
    expect(text(empty)).toBe('No live Fleet sessions.')

    fleet.listValue = [RUNNING_TARGET, DELEGATED_TARGET]
    const populated = success(await call(ctx, 'fleet_list', {}, { agent: owner }))
    expect(fleet.calls.listTargets.at(-1)).toEqual({ callerAgent: owner, callerSessionId: 'caller' })
    expect(populated.value).toEqual({ agents: [RUNNING_TARGET, DELEGATED_TARGET], count: 2 })
    expect(text(populated)).toBe(`Found 2 live Fleet sessions: ${JSON.stringify([RUNNING_TARGET, DELEGATED_TARGET])}`)
    expect(ctx.tools.get('fleet_list')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'List Fleet sessions', kind: 'search',
    })
  })

  it('5. maps inspect arguments, validates tail size before Fleet, and renders complete output and card data', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')
    fleet.inspectValue = {
      agent: {
        ...RUNNING_ROOT,
        omittedMessages: 0,
        tailMessages: [
          { messageId: 'user-1', role: 'user', text: 'question', textTruncated: false },
          { messageId: 'assistant-1', role: 'assistant', text: 'answer', textTruncated: false },
        ],
      },
      selection: { handle: 'fs_target', expiresAt: 2_000 },
    }

    const result = success(await call(ctx, 'fleet_inspect', {
      target_ref: 'ft_target', tail_messages: 2,
    }, { agent: owner }))
    expect(fleet.calls.inspectTarget).toEqual([['ft_target', {
      callerAgent: owner, callerSessionId: 'caller', tailMessages: 2,
    }]])
    expect(result.value).toEqual(fleet.inspectValue)
    expect(text(result)).toBe(
      `Fleet session target is running with direct control. Write selection fs_target expires at 2000. Summary: ${JSON.stringify(fleet.inspectValue.agent)}`,
    )
    expect(ctx.tools.get('fleet_inspect')?.presentCall?.({ target_ref: 'ft_target', tail_messages: 2 })).toEqual({
      card: 'generic',
      title: 'Inspect Fleet target ft_target',
      kind: 'search',
      rawInput: { targetRef: 'ft_target', tailMessages: 2 },
    })
    expect(ctx.tools.get('fleet_inspect')?.presentCall?.({ target_ref: 'ft_target' })).toEqual({
      card: 'generic',
      title: 'Inspect Fleet target ft_target',
      kind: 'search',
      rawInput: { targetRef: 'ft_target' },
    })

    const withoutTail = success(await call(ctx, 'fleet_inspect', {
      target_ref: 'ft_target',
    }, { agent: owner }))
    expect(fleet.calls.inspectTarget.at(-1)).toEqual(['ft_target', { callerAgent: owner, callerSessionId: 'caller' }])
    expect(withoutTail.value).toEqual(fleet.inspectValue)

    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const before = fleet.calls.inspectTarget.length
      const failed = await call(ctx, 'fleet_inspect', {
        target_ref: 'ft_target', tail_messages: invalid,
      }, { agent: owner })
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain('tail_messages must be a positive safe integer')
      expect(fleet.calls.inspectTarget).toHaveLength(before)
    }
  })

  it.each([
    ['fleet_inspect', [
      { target_ref: '   ' },
      { target_ref: ' ft_target' },
      { target_ref: 'ft_target', tail_messages: 0 },
      { target_ref: 'ft_target', tail_messages: 1.5 },
    ]],
    ['fleet_send', [
      { selection_handle: '   ', text: 'message' },
      { selection_handle: 'fs_target ', text: 'message' },
      { selection_handle: 'fs_target', text: ' \n ' },
    ]],
    ['fleet_steer', [
      { selection_handle: '\t', text: 'message' },
      { selection_handle: 'fs_target', text: '\t' },
    ]],
    ['fleet_cancel', [{ selection_handle: '\n' }]],
  ] as const)('5b. makes %s fall back to a generic replay card for semantic invalidity', async (name, argsList) => {
    const { ctx } = await harness()
    for (const args of argsList) {
      expect(ctx.tools.get(name)?.presentCall?.(args)).toBeUndefined()
    }
  })
})

describe('Fleet write tools', () => {
  it('6. maps selected send/steer, original text, and caller identity; model identity fields do not override it', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')

    const sent = success(await call(ctx, 'fleet_send', {
      selection_handle: 'fs_send', text: '  keep spacing  ',
      caller_session_id: 'forged-caller', sender_session_id: 'forged-sender', target_session_id: 'forged-target',
    }, { agent: owner }))
    expect(fleet.calls.sendSelected).toEqual([['fs_send', '  keep spacing  ', { callerAgent: owner, callerSessionId: 'caller' }]])
    expect(sent.value).toEqual({ sessionId: 'target', messageId: 'send-message', deliveryId: 'fd-send' })
    expect(text(sent)).toBe('Queued follow-up send-message for confirmed Fleet session target. Delivery fd-send.')
    expect(ctx.tools.get('fleet_send')?.presentCall?.({
      selection_handle: 'fs_send', text: 'secret body',
    })).toEqual({
      card: 'generic', title: 'Send message to confirmed Fleet target', kind: 'execute',
      rawInput: { selectionHandle: 'fs_send' },
    })

    const steered = success(await call(ctx, 'fleet_steer', {
      selection_handle: 'fs_steer', text: 'turn left',
    }, { agent: owner }))
    expect(fleet.calls.steerSelected).toEqual([['fs_steer', 'turn left', { callerAgent: owner, callerSessionId: 'caller' }]])
    expect(steered.value).toEqual({ sessionId: 'target', messageId: 'steer-message', deliveryId: 'fd-steer' })
    expect(text(steered)).toBe('Submitted steering message steer-message for confirmed Fleet session target. Delivery fd-steer.')
    expect(ctx.tools.get('fleet_steer')?.presentCall?.({
      selection_handle: 'fs_steer', text: 'secret body',
    })).toEqual({
      card: 'generic', title: 'Steer confirmed Fleet target', kind: 'execute',
      rawInput: { selectionHandle: 'fs_steer' },
    })

    const failed = await call(ctx, 'fleet_send', {
      selection_handle: 'fs_invalid', text: 'x',
    }, { agent: owner })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('No action was taken. Do not substitute another Fleet session.')
    expect(failed.isError && failed.error.info).toEqual({
      name: 'FleetError', code: 'fleet-selection-invalid',
    })
  })

  it('7. rejects agentless and invalid confirmed-target calls before every Fleet call', async () => {
    const { ctx, fleet } = await harness()
    for (const [name, args, message] of [
      ['fleet_list', {}, 'fleet_list requires an owning agent session'],
      ['fleet_inspect', { target_ref: 'ft_target' }, 'fleet_inspect requires an owning agent session'],
    ] as const) {
      const failed = await call(ctx, name, args)
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain(message)
    }
    expect(fleet.calls.listTargets).toEqual([])
    expect(fleet.calls.inspectTarget).toEqual([])

    const attempts = [
      ['fleet_send', { selection_handle: 'fs_target', text: 'x' }, 'fleet_send requires an owning agent session'],
      ['fleet_steer', { selection_handle: 'fs_target', text: 'x' }, 'fleet_steer requires an owning agent session'],
      ['fleet_cancel', { selection_handle: 'fs_target' }, 'fleet_cancel requires an owning agent session'],
    ] as const

    for (const [name, args, message] of attempts) {
      const failed = await call(ctx, name, args)
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain(message)
    }

    const owner = fakeAgent('caller')
    for (const [name, args, message] of [
      ['fleet_send', { selection_handle: ' ', text: 'x' }, 'selection_handle must be a non-empty exact handle'],
      ['fleet_send', { selection_handle: 'fs_target ', text: 'x' }, 'selection_handle must be a non-empty exact handle'],
      ['fleet_send', { selection_handle: 'fs_target', text: ' \n ' }, 'text must not be empty'],
      ['fleet_steer', { selection_handle: '', text: 'x' }, 'selection_handle must be a non-empty exact handle'],
      ['fleet_steer', { selection_handle: 'fs_target', text: '\t' }, 'text must not be empty'],
      ['fleet_cancel', { selection_handle: ' ' }, 'selection_handle must be a non-empty exact handle'],
    ] as const) {
      const failed = await call(ctx, name, args, { agent: owner })
      expect(failed.isError).toBe(true)
      expect(text(failed)).toContain(message)
    }
    expect(fleet.calls.sendSelected).toEqual([])
    expect(fleet.calls.steerSelected).toEqual([])
    expect(fleet.calls.cancelSelected).toEqual([])
  })

  it('8. maps cancel caller and optional keepInbox without inventing a default', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')

    const omitted = success(await call(ctx, 'fleet_cancel', {
      selection_handle: 'fs_cancel',
    }, { agent: owner }))
    const supplied = success(await call(ctx, 'fleet_cancel', {
      selection_handle: 'fs_cancel_2', keep_inbox: false,
    }, { agent: owner }))

    expect(fleet.calls.cancelSelected).toEqual([
      ['fs_cancel', { callerAgent: owner, callerSessionId: 'caller' }],
      ['fs_cancel_2', { callerAgent: owner, callerSessionId: 'caller', keepInbox: false }],
    ])
    expect(omitted.value).toEqual({ sessionId: 'target', accepted: true })
    expect(supplied.value).toEqual({ sessionId: 'target', accepted: true })
    expect(text(omitted)).toBe('Cancellation accepted for confirmed Fleet session target.')
    expect(ctx.tools.get('fleet_cancel')?.presentCall?.({ selection_handle: 'fs_cancel' })).toEqual({
      card: 'generic', title: 'Cancel confirmed Fleet target', kind: 'execute',
      rawInput: { selectionHandle: 'fs_cancel' },
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
      callId: CallId('mode-inspect'), name: 'fleet_inspect', arguments: { target_ref: 'ft_target' },
      signal: new AbortController().signal,
    })).toEqual({ kind: 'parallel' })
    for (const [name, args] of [
      ['fleet_send', { selection_handle: 'fs_target', text: 'message' }],
      ['fleet_steer', { selection_handle: 'fs_target', text: 'direction' }],
      ['fleet_cancel', { selection_handle: 'fs_target' }],
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
      ['fleet_send', { selection_handle: 'fs_target', text: 'message' }],
      ['fleet_steer', { selection_handle: 'fs_target', text: 'direction' }],
      ['fleet_cancel', { selection_handle: 'fs_target' }],
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
      ['fleet_send', { selection_handle: 'fs_target', text: 'x' }],
      ['fleet_steer', { selection_handle: 'fs_target', text: 'x' }],
      ['fleet_cancel', { selection_handle: 'fs_target' }],
    ] as const) {
      const failed = await call(ctx, name, args, { agent: owner, signal: controller.signal })
      expect(failed.isError).toBe(true)
      expect(failed.isError && failed.error.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    }
    expect(fleet.calls.sendSelected).toEqual([])
    expect(fleet.calls.steerSelected).toEqual([])
    expect(fleet.calls.cancelSelected).toEqual([])
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
      selection_handle: 'fs_target', text: 'message',
    }, { agent: owner, signal: controller.signal })

    expect(fleet.calls.sendSelected).toEqual([['fs_target', 'message', { callerAgent: owner, callerSessionId: 'caller' }]])
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      isError: true,
      error: { info: { name: 'AbortError', code: 'ABORTED' } },
    })
  })

  it('11. preserves every canonical value through JSON and rejects invalid provider output', async () => {
    const { ctx, fleet } = await harness()
    const owner = fakeAgent('caller')
    fleet.listValue = [RUNNING_TARGET, DELEGATED_TARGET]
    fleet.inspectValue = {
      agent: {
        ...DELEGATED,
        omittedMessages: 0,
        tailMessages: [{ messageId: 'message', role: 'assistant', text: 'done', textTruncated: false }],
      },
    }

    const successes = [
      await call(ctx, 'fleet_list', {}, { agent: owner }),
      await call(ctx, 'fleet_inspect', { target_ref: 'ft_child' }, { agent: owner }),
      await call(ctx, 'fleet_send', { selection_handle: 'fs_target', text: 'x' }, { agent: owner }),
      await call(ctx, 'fleet_steer', { selection_handle: 'fs_target', text: 'x' }, { agent: owner }),
      await call(ctx, 'fleet_cancel', { selection_handle: 'fs_target' }, { agent: owner }),
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
    const extra = await call(ctx, 'fleet_list', {}, { agent: owner })
    expect(extra.isError).toBe(true)
    expect(extra.isError && extra.error.info?.name).toBe('ToolOutputError')
    expect(text(extra)).toContain('unexpected')

    fleet.badListOutput = 'type'
    const wrongType = await call(ctx, 'fleet_list', {}, { agent: owner })
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
    expect(source.match(/callerAgent: exec\.agent/g)).toHaveLength(5)
    expect(source.match(/callerSessionId: exec\.agent\.session\.id/g)).toHaveLength(5)
  })
})
