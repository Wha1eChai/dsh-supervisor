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
}

interface StubAgent extends Agent {
  status: AgentStatus
  readonly followup: ReturnType<typeof vi.fn>
  readonly steer: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
}

const disposals: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposals.length > 0) await disposals.pop()?.()
})

async function createHarness(config: Config = TEST_CONFIG, subagents = false) {
  const ctx = new Context()
  const registryFiber = await ctx.plugin(AgentRegistry)
  if (subagents) {
    ctx.provide('subagents', { marker: true })
  }
  const fleetFiber = await ctx.plugin(InProcessFleetProvider, config)
  disposals.push(() => registryFiber.dispose())
  disposals.push(() => fleetFiber.dispose())
  return { ctx, registryFiber, fleetFiber }
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

  it('2. applies runningOnly and rootsOnly filters', async () => {
    const { ctx } = await createHarness()
    const idleRoot = createStubAgent(ctx, 'idle-root')
    const runningRoot = createStubAgent(ctx, 'running-root', { status: 'running' })
    const runningChild = createStubAgent(ctx, 'running-child', { status: 'running', parentSessionId: 'running-root' })
    register(ctx, idleRoot, runningRoot, runningChild)

    expect(ctx.fleet.list({ runningOnly: true }).map(view => view.sessionId)).toEqual(['running-root', 'running-child'])
    expect(ctx.fleet.list({ rootsOnly: true }).map(view => view.sessionId)).toEqual(['idle-root', 'running-root'])
    expect(ctx.fleet.list({ runningOnly: true, rootsOnly: true }).map(view => view.sessionId)).toEqual(['running-root'])
  })

  it('3. classifies origin or parent lineage as delegated', async () => {
    const { ctx } = await createHarness()
    register(
      ctx,
      createStubAgent(ctx, 'origin-child', { origin: 'subagent' }),
      createStubAgent(ctx, 'parent-child', { parentSessionId: 'root' }),
    )

    expect(ctx.fleet.list().map(view => [view.sessionId, view.kind, view.parentSessionId])).toEqual([
      ['origin-child', 'delegated', undefined],
      ['parent-child', 'delegated', 'root'],
    ])
  })

  it('4. exposes subagent control but defers delegated writes without Agent calls', async () => {
    const { ctx } = await createHarness(TEST_CONFIG, true)
    const child = createStubAgent(ctx, 'child', { origin: 'subagent' })
    register(ctx, child)

    expect(ctx.fleet.list()[0]?.control).toBe('subagent')
    expectFleetCode(() => ctx.fleet.send('child', 'hello'), 'fleet-delegated-write-deferred')
    expectFleetCode(() => ctx.fleet.steer('child', 'hello'), 'fleet-delegated-write-deferred')
    expectFleetCode(() => ctx.fleet.cancel('child'), 'fleet-delegated-write-deferred')
    expect(child.followup).not.toHaveBeenCalled()
    expect(child.steer).not.toHaveBeenCalled()
    expect(child.cancel).not.toHaveBeenCalled()
  })

  it('5. makes delegated agents observe-only without subagents and never calls Agent writes', async () => {
    const { ctx } = await createHarness()
    const child = createStubAgent(ctx, 'child', { parentSessionId: 'root' })
    register(ctx, child)

    expect(ctx.fleet.list()[0]?.control).toBe('observe-only')
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

  it('12. projects created/status/disposed and stops after idempotent disposal or unload', async () => {
    const { ctx, fleetFiber } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    const first: string[] = []
    const second: string[] = []
    const disposeFirst = ctx.fleet.subscribe((event) => {
      first.push(`${event.type}:${event.agent.status}`)
    })
    ctx.fleet.subscribe((event) => {
      second.push(`${event.type}:${event.agent.status}`)
    })
    const [detach] = register(ctx, root)

    root.status = 'running'
    emitStatus(ctx, root)
    disposeFirst()
    disposeFirst()
    root.status = 'idle'
    emitStatus(ctx, root)
    detach?.()
    expect(first).toEqual(['created:idle', 'status:running'])
    expect(second).toEqual(['created:idle', 'status:running', 'status:idle', 'disposed:idle'])

    await fleetFiber.dispose()
    root.status = 'running'
    emitStatus(ctx, root)
    expect(second).toEqual(['created:idle', 'status:running', 'status:idle', 'disposed:idle'])
  })

  it('rejects every retained service operation after provider unload without registry or Agent access', async () => {
    const { ctx, fleetFiber } = await createHarness()
    const root = createStubAgent(ctx, 'root')
    register(ctx, root)
    const fleet = ctx.fleet

    await fleetFiber.dispose()
    const listAgents = vi.spyOn(ctx.agents, 'list')
    const getAgent = vi.spyOn(ctx.agents, 'get')

    expectFleetCode(() => fleet.list(), 'fleet-unavailable')
    expectFleetCode(() => fleet.inspect('root'), 'fleet-unavailable')
    expectFleetCode(() => fleet.send('root', 'follow up'), 'fleet-unavailable')
    expectFleetCode(() => fleet.steer('root', 'change direction'), 'fleet-unavailable')
    expectFleetCode(() => fleet.cancel('root'), 'fleet-unavailable')
    expectFleetCode(() => fleet.subscribe(() => {}), 'fleet-unavailable')
    expect(listAgents).not.toHaveBeenCalled()
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
    })
    await expect(fiber).rejects.toThrow('defaultTailMessages must be less than or equal to maxTailMessages')
    await fiber.dispose()
    await agentFiber.dispose()
  })
})
