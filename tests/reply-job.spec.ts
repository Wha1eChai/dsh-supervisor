import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { FleetReplyResult, FleetReplyWaitOptions } from '../src/types.js'
import { FleetService } from '../src/service.js'
import * as replyJobPlugin from '../src/reply-job.js'

const contexts: Context[] = []
const loadReplyJob = replyJobPlugin as any

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()?.fiber.dispose()
})

function agent(ctx: Context, id: string): Agent {
  const session = Session.create(SessionId(id))
  return { id: session.id, session, ctx } as Agent
}

class ReplyFleet extends FleetService {
  readonly waits: Array<[string, FleetReplyWaitOptions]> = []
  waiter: Promise<FleetReplyResult> = new Promise(() => {})

  constructor(ctx: Context) { super(ctx) }
  list() { return [] }
  inspect(): never { throw new Error('unused') }
  send(): never { throw new Error('unused') }
  steer(): never { throw new Error('unused') }
  cancel(): never { throw new Error('unused') }
  listTargets() { return [] }
  inspectTarget(): never { throw new Error('unused') }
  sendSelected(): never { throw new Error('unused') }
  steerSelected(): never { throw new Error('unused') }
  cancelSelected(): never { throw new Error('unused') }
  subscribe() { return () => {} }
  waitForReply(receipt: string, options: FleetReplyWaitOptions): Promise<FleetReplyResult> {
    this.waits.push([receipt, options])
    return this.waiter
  }
}

async function harness(withJobs = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ReplyFleet)
  if (withJobs) {
    await ctx.plugin(LocalJobRegistry, { maxConcurrentJobsPerOwner: 2 })
    ctx.jobs.attachController('reply-job-test')
  }
  await ctx.plugin(loadReplyJob, { maxOutputBytes: 1024 })
  return { ctx, fleet: ctx.fleet as ReplyFleet }
}

describe('Fleet reply job Consumer', () => {
  it('registers in its composition scope instead of leaking into sibling agents', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ReplyFleet)
    await ctx.plugin(LocalJobRegistry, { maxConcurrentJobsPerOwner: 2 })

    const withFleetWait = createScope(ctx, {})
    const withoutFleetWait = createScope(ctx, {})
    await withFleetWait.ctx.plugin(loadReplyJob, { maxOutputBytes: 1024 })

    const servedKey = {}
    const unservedKey = {}
    bindScopeParent(servedKey, scopeOf(withFleetWait.ctx) as object)
    bindScopeParent(unservedKey, scopeOf(withoutFleetWait.ctx) as object)

    expect(ctx.tools.schemas(servedKey).map(schema => schema.name)).toEqual(['fleet_wait'])
    expect(ctx.tools.schemas(unservedKey).map(schema => schema.name)).toEqual([])
    expect(ctx.tools.schemas()).toEqual([])

    const unserved = agent(withoutFleetWait.ctx, 'unserved-owner')
    ctx.agents.register(unserved)
    const result = await ctx.tools.execute({
      callId: CallId('unserved-reply-job'),
      name: 'fleet_wait',
      arguments: { reply_receipt: 'fr_1234567890abcdef' },
      signal: new AbortController().signal,
      agent: unserved,
    })
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })
  })

  it('appears only with jobs and starts one owner-scoped final-output job', async () => {
    const absent = await harness(false)
    expect(absent.ctx.tools.get('fleet_wait')).toBeUndefined()
    await absent.ctx.fiber.dispose()
    contexts.pop()

    const { ctx, fleet } = await harness()
    const owner = agent(ctx, 'owner')
    ctx.agents.register(owner)
    let resolve!: (result: FleetReplyResult) => void
    fleet.waiter = new Promise((settle) => { resolve = settle })
    const result = await ctx.tools.execute({
      callId: CallId('reply-job'),
      name: 'fleet_wait',
      arguments: { reply_receipt: 'fr_1234567890abcdef' },
      signal: new AbortController().signal,
      agent: owner,
    })
    if (result.isError) throw new Error(`${result.error.message} ${JSON.stringify(result.error.info)}`)
    const jobId = (result.value as { jobId: string }).jobId
    expect(jobId).toMatch(/^fleet-reply-/)
    expect(fleet.waits).toEqual([[
      'fr_1234567890abcdef',
      expect.objectContaining({ callerAgent: owner, callerSessionId: owner.session.id, signal: expect.any(AbortSignal) }),
    ]])
    expect(ctx.jobs.get(jobId as never, owner)).toMatchObject({
      status: 'running',
      outputLimitBytes: 1024,
    })

    resolve({
      outcome: 'turn-ended',
      sessionId: 'target',
      messageId: 'message',
      deliveryId: 'fd_1234567890abcdef' as never,
      turn: 2,
      admitted: true,
      assistantMessages: [],
      omittedAssistantMessages: 0,
      turnEndReason: { kind: 'completed' },
    })
    await vi.waitFor(() => { expect(ctx.jobs.get(jobId as never, owner).status).toBe('completed') })
    const read = ctx.jobs.read(jobId as never, owner)
    expect(read.text).toContain('"outcome":"turn-ended"')
  })

  it('job cancellation aborts only the reply observation', async () => {
    const { ctx, fleet } = await harness()
    const owner = agent(ctx, 'owner')
    ctx.agents.register(owner)
    fleet.waiter = new Promise((_resolve, reject) => {
      queueMicrotask(() => {
        const attach = () => {
          const signal = fleet.waits[0]?.[1].signal
          if (signal === undefined) {
            queueMicrotask(attach)
            return
          }
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }
        attach()
      })
    })
    const result = await ctx.tools.execute({
      callId: CallId('reply-job-kill'),
      name: 'fleet_wait',
      arguments: { reply_receipt: 'fr_1234567890abcdef' },
      signal: new AbortController().signal,
      agent: owner,
    })
    if (result.isError) throw new Error(result.error.message)
    const jobId = (result.value as { jobId: never }).jobId
    expect(ctx.jobs.kill(jobId, owner, 'not needed')).toBe('requested')
    await vi.waitFor(() => { expect(ctx.jobs.get(jobId, owner).status).toBe('killed') })
  })
})
