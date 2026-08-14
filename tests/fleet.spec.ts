import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentCarrier, Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/index.js'
import { type Config, FleetError, InProcessFleetProvider } from '../src/index.js'

const TEST_CONFIG: Config = {
  defaultTailMessages: 2,
  maxTailMessages: 3,
  maxMessageTextChars: 5,
  targetRefTtlMs: 1_000,
  selectionTtlMs: 500,
  maxSelectionsPerCaller: 2,
}

interface StubAgent extends Agent {
  status: AgentStatus
  readonly followup: ReturnType<typeof vi.fn>
  readonly steer: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
}

const disposals: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.useRealTimers()
  while (disposals.length > 0) await disposals.pop()?.()
})

async function createRegistryHarness(subagents = false) {
  const ctx = new Context()
  const registryFiber = await ctx.plugin(AgentRegistry)
  if (subagents) {
    ctx.provide('subagents', { marker: true })
  }
  disposals.push(() => registryFiber.dispose())
  return { ctx, registryFiber }
}

async function mountFleet(ctx: Context, config: Config = TEST_CONFIG) {
  const fleetFiber = await ctx.plugin(InProcessFleetProvider, config)
  disposals.push(() => fleetFiber.dispose())
  return fleetFiber
}

async function createHarness(config: Config = TEST_CONFIG, subagents = false) {
  const harness = await createRegistryHarness(subagents)
  const fleetFiber = await mountFleet(harness.ctx, config)
  return { ...harness, fleetFiber }
}

function createStubAgent(
  ctx: Context,
  idText: string,
  options: {
    status?: AgentStatus
    parentSessionId?: string
    origin?: 'subagent'
    cwd?: string
    seed?: readonly SessionEvent[]
    queue?: { nextTurn?: number; nextStep?: number }
  } = {},
): StubAgent {
  const id = SessionId(idText)
  const session = Session.create(id, options.seed, {
    version: 0,
    id,
    createdAt: 1,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.parentSessionId === undefined ? {} : { parentSession: SessionId(options.parentSessionId) }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  for (let index = 0; index < (options.queue?.nextTurn ?? 0); index += 1) {
    inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: `turn-${index}` }],
      source: { kind: 'user' },
    }))
  }
  for (let index = 0; index < (options.queue?.nextStep ?? 0); index += 1) {
    inbox.append('next-step', createUserMessage({
      content: [{ type: 'text', text: `step-${index}` }],
      source: { kind: 'user' },
    }))
  }
  return {
    id,
    options: {},
    session,
    inbox,
    status: options.status ?? 'idle',
    ctx,
    followup: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
    send: vi.fn(),
    inject: vi.fn(),
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
  }
}

function register(ctx: Context, ...agents: StubAgent[]): Array<() => void> {
  return agents.map(agent => ctx.agents.register(agent))
}

function enterChild(ctx: Context, child: StubAgent, owner: StubAgent): () => void {
  const detach = ctx.agents.enter(child, owner)
  ctx.agents.announce(child)
  expect(ctx.agents.isOwnedBy(child.id, owner)).toBe(true)
  return detach
}

function emitStatus(ctx: Context, agent: StubAgent): void {
  ctx.emit(agentCarrier(agent), 'agent/status', { agent, status: agent.status })
}

function expectFleetCode(action: () => unknown, code: FleetError['code']): void {
  try {
    action()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(FleetError)
    expect((error as FleetError).code).toBe(code)
  }
}

function appendTurn(session: Session, userText: string, assistantText: string): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: assistantText }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

describe('Fleet L1 behavior', () => {
  it('1. lists two live root agents with complete JSON-safe fields', async () => {
    const { ctx } = await createHarness()
    const first = createStubAgent(ctx, 'root-a', { cwd: 'D:/work/a', queue: { nextTurn: 1, nextStep: 2 } })
    const second = createStubAgent(ctx, 'root-b')
    register(ctx, first, second)

    expect(ctx.fleet.list()).toEqual([
      {
        sessionId: 'root-a', status: 'idle', kind: 'root', control: 'direct', cwd: 'D:/work/a',
        blank: true, queueCount: 3, updatedAt: expect.any(Number),
      },
      {
        sessionId: 'root-b', status: 'idle', kind: 'root', control: 'direct',
        blank: true, queueCount: 0,
      },
    ])
    expect(() => JSON.stringify(ctx.fleet.list())).not.toThrow()
  })

  it('2. applies runningOnly and rootsOnly from runtime ownership', async () => {
    const { ctx } = await createHarness()
    const idleRoot = createStubAgent(ctx, 'idle-root')
    const runningRoot = createStubAgent(ctx, 'running-root', { status: 'running' })
    const runningChild = createStubAgent(ctx, 'running-child', { status: 'running' })
    register(ctx, idleRoot, runningRoot)
    enterChild(ctx, runningChild, runningRoot)

    expect(ctx.fleet.list({ runningOnly: true }).map(view => view.sessionId)).toEqual(['running-root', 'running-child'])
    expect(ctx.fleet.list({ rootsOnly: true }).map(view => view.sessionId)).toEqual(['idle-root', 'running-root'])
    expect(ctx.fleet.list({ runningOnly: true, rootsOnly: true }).map(view => view.sessionId)).toEqual(['running-root'])
  })

  it.each<[string, { origin: 'subagent'; parentSessionId?: string }]>([
    ['origin and parent lineage', { origin: 'subagent', parentSessionId: 'durable-parent' }],
    ['origin lineage', { origin: 'subagent' }],
  ])('3. keeps a normally registered runtime root with %s root, direct, and writable', async (_label, metadata) => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'lineage-root', metadata)
    register(ctx, root)

    expect(ctx.fleet.list()).toEqual([expect.objectContaining({
      sessionId: 'lineage-root',
      kind: 'root',
      control: 'direct',
      ...(metadata.parentSessionId === undefined ? {} : { parentSessionId: metadata.parentSessionId }),
    })])
    expect(ctx.fleet.list({ rootsOnly: true }).map(view => view.sessionId)).toEqual(['lineage-root'])
    expect(ctx.fleet.inspect('lineage-root')).toEqual(expect.objectContaining({
      sessionId: 'lineage-root',
      kind: 'root',
      control: 'direct',
      ...(metadata.parentSessionId === undefined ? {} : { parentSessionId: metadata.parentSessionId }),
    }))

    ctx.fleet.send('lineage-root', 'follow up')
    ctx.fleet.steer('lineage-root', 'steer')
    ctx.fleet.cancel('lineage-root')
    expect(root.followup).toHaveBeenCalledOnce()
    expect(root.steer).toHaveBeenCalledOnce()
    expect(root.cancel).toHaveBeenCalledOnce()
  })

  it('4. classifies a metadata-free runtime child as delegated and defers every write with subagents', async () => {
    const { ctx } = await createHarness(TEST_CONFIG, true)
    const owner = createStubAgent(ctx, 'owner')
    const child = createStubAgent(ctx, 'child')
    register(ctx, owner)
    enterChild(ctx, child, owner)

    expect(ctx.fleet.list().map(view => [view.sessionId, view.kind, view.control])).toEqual([
      ['owner', 'root', 'direct'],
      ['child', 'delegated', 'subagent'],
    ])
    const childView = ctx.fleet.list().find(view => view.sessionId === 'child')
    expect(childView).toEqual(expect.objectContaining({
      sessionId: 'child', kind: 'delegated', control: 'subagent',
    }))
    expect(childView).not.toHaveProperty('parentSessionId')
    expect(ctx.fleet.list({ rootsOnly: true }).map(view => view.sessionId)).toEqual(['owner'])
    expect(ctx.fleet.inspect('child')).toEqual(expect.objectContaining({
      sessionId: 'child', kind: 'delegated', control: 'subagent',
    }))
    expectFleetCode(() => ctx.fleet.send('child', 'hello'), 'fleet-delegated-write-deferred')
    expectFleetCode(() => ctx.fleet.steer('child', 'hello'), 'fleet-delegated-write-deferred')
    expectFleetCode(() => ctx.fleet.cancel('child'), 'fleet-delegated-write-deferred')
    expect(child.followup).not.toHaveBeenCalled()
    expect(child.steer).not.toHaveBeenCalled()
    expect(child.cancel).not.toHaveBeenCalled()
  })

  it('5. makes a metadata-free runtime child observe-only without subagents', async () => {
    const { ctx } = await createHarness()
    const owner = createStubAgent(ctx, 'owner')
    const child = createStubAgent(ctx, 'child')
    register(ctx, owner)
    enterChild(ctx, child, owner)

    expect(ctx.fleet.list().find(view => view.sessionId === 'child')).toEqual(expect.objectContaining({
      kind: 'delegated', control: 'observe-only',
    }))
    expect(ctx.fleet.inspect('child')).toEqual(expect.objectContaining({
      kind: 'delegated', control: 'observe-only',
    }))
    expectFleetCode(() => ctx.fleet.send('child', 'hello'), 'fleet-observe-only')
    expectFleetCode(() => ctx.fleet.steer('child', 'hello'), 'fleet-observe-only')
    expectFleetCode(() => ctx.fleet.cancel('child'), 'fleet-observe-only')
    expect(child.followup).not.toHaveBeenCalled()
    expect(child.steer).not.toHaveBeenCalled()
    expect(child.cancel).not.toHaveBeenCalled()
  })

  it('6. sends and steers exact plugin-sourced user messages', async () => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)

    const sent = ctx.fleet.send('root', 'follow up')
    const steered = ctx.fleet.steer('root', 'change direction')
    expect(root.followup).toHaveBeenCalledOnce()
    expect(root.steer).toHaveBeenCalledOnce()
    const followupMessage = root.followup.mock.calls[0]?.[0]
    const steeringMessage = root.steer.mock.calls[0]?.[0]
    expect(followupMessage).toMatchObject({
      id: sent.messageId,
      role: 'user',
      content: [{ type: 'text', text: 'follow up' }],
      source: { kind: 'plugin', plugin: 'dsh-supervisor' },
    })
    expect(steeringMessage).toMatchObject({
      id: steered.messageId,
      role: 'user',
      content: [{ type: 'text', text: 'change direction' }],
      source: { kind: 'plugin', plugin: 'dsh-supervisor' },
    })
  })

  it('7. cancels with the exact hook cause and forwards keepInbox', async () => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)

    expect(ctx.fleet.cancel('root', { keepInbox: true })).toEqual({ accepted: true })
    expect(root.cancel).toHaveBeenCalledWith(
      { kind: 'hook', reason: 'fleet-cancel' },
      { keepInbox: true },
    )
  })

  it('8. rejects self-targeting for every write operation', async () => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)

    expectFleetCode(() => ctx.fleet.send('root', 'x', { callerSessionId: 'root' }), 'fleet-self-target')
    expectFleetCode(() => ctx.fleet.steer('root', 'x', { callerSessionId: 'root' }), 'fleet-self-target')
    expectFleetCode(() => ctx.fleet.cancel('root', { callerSessionId: 'root' }), 'fleet-self-target')
    expect(root.followup).not.toHaveBeenCalled()
    expect(root.steer).not.toHaveBeenCalled()
    expect(root.cancel).not.toHaveBeenCalled()
  })

  it('9. rejects unknown ids for every operation', async () => {
    const { ctx } = await createHarness()
    expectFleetCode(() => ctx.fleet.inspect('missing'), 'fleet-not-found')
    expectFleetCode(() => ctx.fleet.send('missing', 'x'), 'fleet-not-found')
    expectFleetCode(() => ctx.fleet.steer('missing', 'x'), 'fleet-not-found')
    expectFleetCode(() => ctx.fleet.cancel('missing'), 'fleet-not-found')
  })

  it('10. rejects empty and whitespace-only text before Agent calls', async () => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)

    expectFleetCode(() => ctx.fleet.send('root', ''), 'fleet-empty-text')
    expectFleetCode(() => ctx.fleet.send('root', '  \n\t '), 'fleet-empty-text')
    expectFleetCode(() => ctx.fleet.steer('root', ' '), 'fleet-empty-text')
    expect(root.followup).not.toHaveBeenCalled()
    expect(root.steer).not.toHaveBeenCalled()
  })

  it('11. uses configured default/max tail sizes and text truncation', async () => {
    const { ctx } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    appendTurn(root.session, '123456789', 'abcdefghij')
    root.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'third-message' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    register(ctx, root)

    const defaultView = ctx.fleet.inspect('root')
    expect(defaultView.tailMessages.map(message => [message.role, message.text])).toEqual([
      ['assistant', 'abcde'],
      ['user', 'third'],
    ])
    const clampedView = ctx.fleet.inspect('root', { tailMessages: 99 })
    expect(clampedView.tailMessages.map(message => message.text)).toEqual(['12345', 'abcde', 'third'])
    expect(() => ctx.fleet.inspect('root', { tailMessages: 0 })).toThrow('tailMessages must be a positive integer')
    expect(() => ctx.fleet.inspect('root', { tailMessages: 1.5 })).toThrow('tailMessages must be a positive integer')
    expect('session' in clampedView).toBe(false)
    expect('events' in clampedView).toBe(false)
    expect(() => JSON.stringify(clampedView)).not.toThrow()
  })

  it('12. keeps root created/status/disposed classification after registry removal', async () => {
    const { ctx, fleetFiber } = await createHarness()
    const root = createStubAgent(ctx, 'root', { origin: 'subagent', parentSessionId: 'durable-parent' })
    const first: string[] = []
    const second: string[] = []
    const disposeFirst = ctx.fleet.subscribe((event) => {
      first.push(`${event.type}:${event.agent.kind}:${event.agent.status}`)
    })
    ctx.fleet.subscribe((event) => {
      second.push(`${event.type}:${event.agent.kind}:${event.agent.status}`)
    })
    const [detach] = register(ctx, root)

    root.status = 'running'
    emitStatus(ctx, root)
    disposeFirst()
    disposeFirst()
    root.status = 'idle'
    emitStatus(ctx, root)
    detach?.()
    expect(first).toEqual(['created:root:idle', 'status:root:running'])
    expect(second).toEqual([
      'created:root:idle',
      'status:root:running',
      'status:root:idle',
      'disposed:root:idle',
    ])

    await fleetFiber.dispose()
    root.status = 'running'
    emitStatus(ctx, root)
    expect(second).toHaveLength(4)
  })

  it('13. keeps metadata-free child created/status/disposed classification after registry removal', async () => {
    const { ctx } = await createHarness(TEST_CONFIG, true)
    const owner = createStubAgent(ctx, 'owner')
    const child = createStubAgent(ctx, 'child')
    register(ctx, owner)
    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      if (event.agent.sessionId === 'child') {
        seen.push(`${event.type}:${event.agent.kind}:${event.agent.control}`)
      }
    })

    const detachChild = enterChild(ctx, child, owner)
    child.status = 'running'
    emitStatus(ctx, child)
    detachChild()

    expect(seen).toEqual([
      'created:delegated:subagent',
      'status:delegated:subagent',
      'disposed:delegated:subagent',
    ])
  })

  it('14. preserves the created classification when an earlier listener requests immediate detach', async () => {
    const { ctx } = await createRegistryHarness()
    const root = createStubAgent(ctx, 'root', { origin: 'subagent', parentSessionId: 'durable-parent' })
    let detach: (() => void) | undefined
    ctx.on('agent/created', ({ agent }) => {
      if (agent === root) detach?.()
    }, { global: true })
    await mountFleet(ctx)
    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      if (event.agent.sessionId === 'root') seen.push(`${event.type}:${event.agent.kind}`)
    })

    detach = ctx.agents.enter(root, undefined)
    ctx.agents.announce(root)

    expect(ctx.agents.get(root.id)).toBeUndefined()
    expect(seen).toEqual(['created:root', 'disposed:root'])
  })

  it('15. seeds already-live root and child classifications without synthetic created events', async () => {
    const { ctx } = await createRegistryHarness(true)
    const root = createStubAgent(ctx, 'root', { origin: 'subagent', parentSessionId: 'durable-parent' })
    const child = createStubAgent(ctx, 'child')
    const [detachRoot] = register(ctx, root)
    const detachChild = enterChild(ctx, child, root)

    await mountFleet(ctx)
    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      seen.push(`${event.type}:${event.agent.sessionId}:${event.agent.kind}`)
    })

    expect(ctx.fleet.list().map(view => [view.sessionId, view.kind, view.control, view.parentSessionId])).toEqual([
      ['root', 'root', 'direct', 'durable-parent'],
      ['child', 'delegated', 'subagent', undefined],
    ])
    expect(ctx.fleet.inspect('root')).toEqual(expect.objectContaining({ kind: 'root', control: 'direct' }))
    expect(ctx.fleet.inspect('child')).toEqual(expect.objectContaining({ kind: 'delegated', control: 'subagent' }))
    expect(seen).toEqual([])

    detachChild()
    detachRoot?.()
    expect(seen).toEqual([
      'disposed:child:delegated',
      'disposed:root:root',
    ])
  })

  it('16. isolates a same-id replacement from stale disposal by exact Agent identity', async () => {
    const { ctx } = await createRegistryHarness()
    const owner = createStubAgent(ctx, 'owner')
    const oldChild = createStubAgent(ctx, 'same')
    const replacement = createStubAgent(ctx, 'same', { origin: 'subagent', parentSessionId: 'durable-parent' })
    register(ctx, owner)
    let detachReplacement: (() => void) | undefined
    ctx.on('agent/disposed', ({ agent }) => {
      if (agent !== oldChild) return
      detachReplacement = ctx.agents.enter(replacement, undefined)
      ctx.agents.announce(replacement)
    }, { global: true })
    await mountFleet(ctx)
    const roots = vi.spyOn(ctx.agents, 'roots')
    const get = vi.spyOn(ctx.agents, 'get')
    const isOwnedBy = vi.spyOn(ctx.agents, 'isOwnedBy')

    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      if (event.agent.sessionId === 'same') {
        seen.push(`${event.type}:${event.agent.kind}:${event.agent.parentSessionId ?? 'none'}`)
      }
    })
    const detachOld = enterChild(ctx, oldChild, owner)
    roots.mockClear()
    get.mockClear()
    isOwnedBy.mockClear()
    detachOld()

    expect(seen).toEqual([
      'created:delegated:none',
      'created:root:durable-parent',
      'disposed:delegated:none',
    ])
    expect(roots).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    expect(isOwnedBy).not.toHaveBeenCalled()
    expect(ctx.fleet.list().filter(view => view.sessionId === 'same')).toEqual([
      expect.objectContaining({ kind: 'root', control: 'direct', parentSessionId: 'durable-parent' }),
    ])
    expect(ctx.fleet.inspect('same')).toEqual(expect.objectContaining({ kind: 'root', control: 'direct' }))
    ctx.fleet.send('same', 'follow up')
    ctx.fleet.steer('same', 'steer')
    ctx.fleet.cancel('same')
    expect(replacement.followup).toHaveBeenCalledOnce()
    expect(replacement.steer).toHaveBeenCalledOnce()
    expect(replacement.cancel).toHaveBeenCalledOnce()

    detachReplacement?.()
    expect(seen.at(-1)).toBe('disposed:root:durable-parent')
  })

  it('17. confirms one exact target through caller-bound references and a single-use selection', async () => {
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller-session')
    const target = createStubAgent(ctx, 'target-session-with-an-opaque-id')
    register(ctx, caller, target)

    const listed = ctx.fleet.listTargets({ callerSessionId: 'caller-session' })
    const targetEntry = listed.find(entry => entry.sessionId === target.id)
    if (targetEntry === undefined) throw new Error('missing target reference')
    expect(targetEntry.targetRef).toMatch(/^ft_[A-Za-z0-9_-]+$/)
    expect(targetEntry.targetRef).not.toContain(target.id)
    expect(targetEntry.targetRefExpiresAt).toBeGreaterThan(Date.now())

    const inspected = ctx.fleet.inspectTarget(targetEntry.targetRef, {
      callerSessionId: 'caller-session',
      tailMessages: 1,
    })
    expect(inspected.agent).toEqual(expect.objectContaining({ sessionId: target.id, kind: 'root' }))
    expect(inspected.selection).toEqual({
      handle: expect.stringMatching(/^fs_[A-Za-z0-9_-]+$/),
      expiresAt: expect.any(Number),
    })
    if (inspected.selection === undefined) throw new Error('missing write selection')

    const sent = ctx.fleet.sendSelected(inspected.selection.handle, 'follow up', {
      callerSessionId: 'caller-session',
    })
    expect(sent).toEqual({ sessionId: target.id, messageId: expect.any(String) })
    expect(target.followup).toHaveBeenCalledOnce()
    expectFleetCode(
      () => ctx.fleet.sendSelected(inspected.selection!.handle, 'duplicate', { callerSessionId: 'caller-session' }),
      'fleet-selection-invalid',
    )
    expect(target.followup).toHaveBeenCalledOnce()

    const issueSelection = () => {
      const current = ctx.fleet.inspectTarget(targetEntry.targetRef, {
        callerSessionId: 'caller-session',
      }).selection
      if (current === undefined) throw new Error('missing renewed write selection')
      return current.handle
    }
    const steered = ctx.fleet.steerSelected(issueSelection(), 'change direction', {
      callerSessionId: 'caller-session',
    })
    expect(steered).toEqual({ sessionId: target.id, messageId: expect.any(String) })
    expect(target.steer).toHaveBeenCalledOnce()

    const canceled = ctx.fleet.cancelSelected(issueSelection(), {
      callerSessionId: 'caller-session',
      keepInbox: true,
    })
    expect(canceled).toEqual({ sessionId: target.id, accepted: true })
    expect(target.cancel).toHaveBeenCalledWith(
      { kind: 'hook', reason: 'fleet-cancel' },
      { keepInbox: true },
    )
  })

  it('18. allows self and delegated inspection without issuing a write selection', async () => {
    const { ctx } = await createHarness(TEST_CONFIG, true)
    const caller = createStubAgent(ctx, 'caller')
    const child = createStubAgent(ctx, 'child')
    register(ctx, caller)
    enterChild(ctx, child, caller)

    const listed = ctx.fleet.listTargets({ callerSessionId: 'caller' })
    const selfRef = listed.find(entry => entry.sessionId === 'caller')?.targetRef
    const childRef = listed.find(entry => entry.sessionId === 'child')?.targetRef
    if (selfRef === undefined || childRef === undefined) throw new Error('missing target reference')

    expect(ctx.fleet.inspectTarget(selfRef, { callerSessionId: 'caller' })).toEqual({
      agent: expect.objectContaining({ sessionId: 'caller', kind: 'root' }),
    })
    expect(ctx.fleet.inspectTarget(childRef, { callerSessionId: 'caller' })).toEqual({
      agent: expect.objectContaining({ sessionId: 'child', kind: 'delegated', control: 'subagent' }),
    })
  })

  it('19. invalidates submitted references on caller mismatch and exposes fail-closed metadata', async () => {
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller')
    const other = createStubAgent(ctx, 'other')
    const target = createStubAgent(ctx, 'target')
    register(ctx, caller, other, target)

    const targetRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'target')?.targetRef
    if (targetRef === undefined) throw new Error('missing target reference')
    let referenceError: FleetError | undefined
    try {
      ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'other' })
    } catch (error) {
      referenceError = error as FleetError
    }
    expect(referenceError).toMatchObject({
      code: 'fleet-target-reference-invalid',
      actionTaken: false,
      targetSubstitutionAllowed: false,
      nextAction: 'relist-or-ask-user',
    })
    expectFleetCode(
      () => ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }),
      'fleet-target-reference-invalid',
    )

    const freshRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'target')?.targetRef
    if (freshRef === undefined) throw new Error('missing fresh target reference')
    const selection = ctx.fleet.inspectTarget(freshRef, { callerSessionId: 'caller' }).selection
    if (selection === undefined) throw new Error('missing selection')
    expectFleetCode(
      () => ctx.fleet.sendSelected(selection.handle, 'wrong caller', { callerSessionId: 'other' }),
      'fleet-selection-invalid',
    )
    expectFleetCode(
      () => ctx.fleet.sendSelected(selection.handle, 'original caller', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
    expect(target.followup).not.toHaveBeenCalled()
  })

  it('20. invalidates references and selections across exact caller or target replacement', async () => {
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller')
    const oldTarget = createStubAgent(ctx, 'same-target')
    const [detachCaller, detachTarget] = register(ctx, caller, oldTarget)

    const firstRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'same-target')?.targetRef
    if (firstRef === undefined) throw new Error('missing target reference')
    const firstSelection = ctx.fleet.inspectTarget(firstRef, { callerSessionId: 'caller' }).selection
    if (firstSelection === undefined) throw new Error('missing selection')

    detachTarget?.()
    const newTarget = createStubAgent(ctx, 'same-target')
    register(ctx, newTarget)
    expectFleetCode(
      () => ctx.fleet.sendSelected(firstSelection.handle, 'stale target', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
    expect(newTarget.followup).not.toHaveBeenCalled()

    const secondRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'same-target')?.targetRef
    if (secondRef === undefined) throw new Error('missing replacement target reference')
    const secondSelection = ctx.fleet.inspectTarget(secondRef, { callerSessionId: 'caller' }).selection
    if (secondSelection === undefined) throw new Error('missing replacement selection')

    detachCaller?.()
    const newCaller = createStubAgent(ctx, 'caller')
    register(ctx, newCaller)
    expectFleetCode(
      () => ctx.fleet.sendSelected(secondSelection.handle, 'stale caller', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
    expect(newTarget.followup).not.toHaveBeenCalled()
  })

  it('21. expires target references and selections at the configured boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller')
    const target = createStubAgent(ctx, 'target')
    register(ctx, caller, target)

    const targetRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'target')?.targetRef
    if (targetRef === undefined) throw new Error('missing target reference')
    vi.setSystemTime(11_000)
    expectFleetCode(
      () => ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }),
      'fleet-target-reference-invalid',
    )

    vi.setSystemTime(20_000)
    const freshRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'target')?.targetRef
    if (freshRef === undefined) throw new Error('missing fresh target reference')
    const selection = ctx.fleet.inspectTarget(freshRef, { callerSessionId: 'caller' }).selection
    if (selection === undefined) throw new Error('missing selection')
    vi.setSystemTime(20_500)
    expectFleetCode(
      () => ctx.fleet.sendSelected(selection.handle, 'expired', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
    expect(target.followup).not.toHaveBeenCalled()
  })

  it('22. preserves a selection after input rejection but consumes it before an uncertain Agent call', async () => {
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller')
    const target = createStubAgent(ctx, 'target')
    register(ctx, caller, target)

    const issueSelection = () => {
      const targetRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
        .find(entry => entry.sessionId === 'target')?.targetRef
      if (targetRef === undefined) throw new Error('missing target reference')
      const selection = ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }).selection
      if (selection === undefined) throw new Error('missing selection')
      return selection.handle
    }

    const reusable = issueSelection()
    expectFleetCode(
      () => ctx.fleet.sendSelected(reusable, '  ', { callerSessionId: 'caller' }),
      'fleet-empty-text',
    )
    ctx.fleet.sendSelected(reusable, 'valid', { callerSessionId: 'caller' })
    expect(target.followup).toHaveBeenCalledOnce()

    const uncertain = issueSelection()
    target.followup.mockImplementationOnce(() => { throw new Error('Agent followup failed after entry') })
    expect(() => ctx.fleet.sendSelected(uncertain, 'may have entered', {
      callerSessionId: 'caller',
    })).toThrow('Agent followup failed after entry')
    expectFleetCode(
      () => ctx.fleet.sendSelected(uncertain, 'must not retry', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
  })

  it('23. bounds live selections per caller by evicting the oldest handle', async () => {
    const { ctx } = await createHarness()
    const caller = createStubAgent(ctx, 'caller')
    const target = createStubAgent(ctx, 'target')
    register(ctx, caller, target)
    const targetRef = ctx.fleet.listTargets({ callerSessionId: 'caller' })
      .find(entry => entry.sessionId === 'target')?.targetRef
    if (targetRef === undefined) throw new Error('missing target reference')

    const first = ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }).selection?.handle
    const second = ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }).selection?.handle
    const third = ctx.fleet.inspectTarget(targetRef, { callerSessionId: 'caller' }).selection?.handle
    if (first === undefined || second === undefined || third === undefined) throw new Error('missing selection')

    expectFleetCode(
      () => ctx.fleet.sendSelected(first, 'evicted', { callerSessionId: 'caller' }),
      'fleet-selection-invalid',
    )
    ctx.fleet.sendSelected(second, 'second', { callerSessionId: 'caller' })
    ctx.fleet.sendSelected(third, 'third', { callerSessionId: 'caller' })
    expect(target.followup).toHaveBeenCalledTimes(2)
  })

  it('rejects every retained service operation after provider unload without registry or Agent access', async () => {
    const { ctx, fleetFiber } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)
    const fleet = ctx.fleet

    await fleetFiber.dispose()
    const listAgents = vi.spyOn(ctx.agents, 'list')
    const rootAgents = vi.spyOn(ctx.agents, 'roots')
    const getAgent = vi.spyOn(ctx.agents, 'get')

    expectFleetCode(() => fleet.list(), 'fleet-unavailable')
    expectFleetCode(() => fleet.inspect('root'), 'fleet-unavailable')
    expectFleetCode(() => fleet.send('root', 'follow up'), 'fleet-unavailable')
    expectFleetCode(() => fleet.steer('root', 'change direction'), 'fleet-unavailable')
    expectFleetCode(() => fleet.cancel('root'), 'fleet-unavailable')
    expectFleetCode(() => fleet.subscribe(() => {}), 'fleet-unavailable')
    expectFleetCode(() => fleet.listTargets({ callerSessionId: 'root' }), 'fleet-unavailable')
    expectFleetCode(() => fleet.inspectTarget('ft_stale', { callerSessionId: 'root' }), 'fleet-unavailable')
    expectFleetCode(() => fleet.sendSelected('fs_stale', 'x', { callerSessionId: 'root' }), 'fleet-unavailable')
    expectFleetCode(() => fleet.steerSelected('fs_stale', 'x', { callerSessionId: 'root' }), 'fleet-unavailable')
    expectFleetCode(() => fleet.cancelSelected('fs_stale', { callerSessionId: 'root' }), 'fleet-unavailable')
    expect(listAgents).not.toHaveBeenCalled()
    expect(rootAgents).not.toHaveBeenCalled()
    expect(getAgent).not.toHaveBeenCalled()
    expect(root.followup).not.toHaveBeenCalled()
    expect(root.steer).not.toHaveBeenCalled()
    expect(root.cancel).not.toHaveBeenCalled()
  })

  it('contains and reports Fleet listener failures without disrupting created or status lifecycles', async () => {
    const { ctx } = await createHarness()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      if (event.type === 'created') throw new Error('created listener failed')
      if (event.type === 'status') return Promise.reject(new Error('status listener failed'))
    })
    ctx.fleet.subscribe((event) => {
      seen.push(event.type)
    })
    const root = createStubAgent(ctx, 'root')
    let detach: (() => void) | undefined

    expect(() => { [detach] = register(ctx, root) }).not.toThrow()
    expect(ctx.agents.get(root.id)).toBe(root)
    root.status = 'running'
    expect(() => emitStatus(ctx, root)).not.toThrow()
    expect(seen).toEqual(['created', 'status'])
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('created listener threw'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('status listener rejected'))
    })

    detach?.()
    expect(ctx.agents.get(root.id)).toBeUndefined()
    expect(seen).toEqual(['created', 'status', 'disposed'])
  })

  it('mounts through the real plugin when agents is available and unload removes fleet and its bridge', async () => {
    const ctx = new Context()
    const agentFiber = await ctx.plugin(AgentRegistry)
    const pluginFiber = await ctx.plugin(plugin, TEST_CONFIG)
    const root = createStubAgent(ctx, 'root')
    const detach = ctx.agents.register(root)
    const seen: string[] = []
    ctx.fleet.subscribe((event) => {
      seen.push(event.type)
    })

    expect(ctx.get('fleet')).toBeInstanceOf(InProcessFleetProvider)
    root.status = 'running'
    emitStatus(ctx, root)
    expect(seen).toEqual(['status'])
    await pluginFiber.dispose()
    expect(ctx.get('fleet')).toBeUndefined()
    root.status = 'idle'
    emitStatus(ctx, root)
    expect(seen).toEqual(['status'])

    detach()
    await agentFiber.dispose()
  })

  it('waits for the required agents service before mounting fleet', async () => {
    const ctx = new Context()
    const pluginFiber = ctx.plugin(plugin, TEST_CONFIG)
    expect(ctx.get('fleet')).toBeUndefined()

    const agentFiber = await ctx.plugin(AgentRegistry)
    await pluginFiber.await()
    expect(ctx.get('fleet')).toBeInstanceOf(InProcessFleetProvider)

    await pluginFiber.dispose()
    await agentFiber.dispose()
  })

  it('fails load when defaultTailMessages exceeds maxTailMessages', async () => {
    const ctx = new Context()
    const agentFiber = await ctx.plugin(AgentRegistry)
    const fiber = ctx.plugin(plugin, {
      defaultTailMessages: 4,
      maxTailMessages: 3,
      maxMessageTextChars: 10,
      targetRefTtlMs: 1_000,
      selectionTtlMs: 500,
      maxSelectionsPerCaller: 2,
    })
    await expect(fiber).rejects.toThrow('defaultTailMessages must be less than or equal to maxTailMessages')
    await fiber.dispose()
    await agentFiber.dispose()
  })
})
