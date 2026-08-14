/**
 * Real-entry proof: a test-only cordis.yml boots both built package entries
 * through the official Loader + Include path and exercises the real ToolRuntime.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function entry(name: string) {
  return [...context!.loader.entries()].find(candidate => candidate.options.name === name)
}

function registerRoot(idText: string): () => void {
  const id = SessionId(idText)
  const session = Session.create(id)
  const agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: context!,
    followup: () => {},
    steer: () => {},
    cancel: () => {},
    send: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
  } as Agent
  return context!.agents.register(agent)
}

describe('built package through real Loader composition', () => {
  it('loads both namespace entries, executes a real Fleet tool, and removes stale Consumers', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: system-prompt',
      "  name: '@deepseek-ai/dsh-system-prompt'",
      '- id: tools',
      "  name: '@deepseek-ai/dsh-tools'",
      '- id: sessions',
      "  name: '@deepseek-ai/dsh-session'",
      '- id: session-title',
      "  name: '@deepseek-ai/dsh-session-title'",
      '  config:',
      '    fallbackMaxWords: 5',
      '    fallbackMaxBytes: 40',
      '    maxTitleBytes: 80',
      '- id: agents',
      "  name: '@deepseek-ai/dsh-agent'",
      '- id: supervisor',
      "  name: '@wha1echai/dsh-supervisor'",
      '- id: supervisor-tools',
      "  name: '@wha1echai/dsh-supervisor/tool'",
      '  config:',
      '    controlMode: full',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-system-prompt') return SystemPrompt
        if (specifier === '@deepseek-ai/dsh-tools') return ToolRuntime
        if (specifier === '@deepseek-ai/dsh-agent') return AgentRegistry
        if (specifier === '@deepseek-ai/dsh-session') return SessionStore
        if (specifier === '@deepseek-ai/dsh-session-title') return SessionTitleService
        if (specifier === '@wha1echai/dsh-supervisor') {
          return import('@wha1echai/dsh-supervisor')
        }
        if (specifier === '@wha1echai/dsh-supervisor/tool') {
          return import('@wha1echai/dsh-supervisor/tool')
        }
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(candidate => candidate.fiber === undefined && !candidate.disabled)
      .map(candidate => candidate.options.name)
    expect(unloaded).toEqual([])
    expect(context.get('fleet')).toBeDefined()
    expect(context.get('sessionTitle')).toBeDefined()
    expect(context.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'fleet_cancel', 'fleet_inspect', 'fleet_list', 'fleet_send', 'fleet_steer',
    ])

    const detachCaller = registerRoot('loader-caller')
    const detachTarget = registerRoot('loader-target')
    const target = context.agents.get(SessionId('loader-target'))
    const caller = context.agents.get(SessionId('loader-caller'))
    if (caller === undefined || target === undefined) throw new Error('missing Loader Agent')
    target.session.append('session/title', {
      title: 'Loader title',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    const listedWithTitle = await context.tools.execute({
      callId: CallId('loader-fleet-list-title'),
      name: 'fleet_list',
      arguments: {},
      signal: new AbortController().signal,
      agent: caller,
    })
    expect(listedWithTitle.isError).toBe(false)
    if (listedWithTitle.isError) throw new Error(listedWithTitle.error.message)
    expect(listedWithTitle.value).toMatchObject({
      agents: [
        expect.objectContaining({ sessionId: 'loader-caller' }),
        expect.objectContaining({ sessionId: 'loader-target', title: 'Loader title' }),
      ],
    })
    const listed = await context.tools.execute({
      callId: CallId('loader-fleet-list'),
      name: 'fleet_list',
      arguments: {},
      signal: new AbortController().signal,
      agent: caller,
    })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error(listed.error.message)
    expect(listed.value).toMatchObject({ count: 2 })
    const listedValue = listed.value as { agents: Array<{ sessionId: string; targetRef: string }>; count: number }
    expect(listedValue.agents).toEqual([
      expect.objectContaining({ sessionId: 'loader-caller', targetRef: expect.stringMatching(/^ft_/) }),
      expect.objectContaining({ sessionId: 'loader-target', targetRef: expect.stringMatching(/^ft_/) }),
    ])
    expect(listed.content[0]).toMatchObject({ type: 'text' })
    const targetEntry = listedValue.agents.find(agent => agent.sessionId === 'loader-target')
    if (targetEntry === undefined) throw new Error('missing Loader target reference')
    const inspected = await context.tools.execute({
      callId: CallId('loader-fleet-inspect-title'),
      name: 'fleet_inspect',
      arguments: { target_ref: targetEntry.targetRef },
      signal: new AbortController().signal,
      agent: caller,
    })
    expect(inspected.isError).toBe(false)
    if (inspected.isError) throw new Error(inspected.error.message)
    expect(inspected.value).toMatchObject({
      agent: { sessionId: 'loader-target', title: 'Loader title', omittedMessages: 0, tailMessages: [] },
    })

    const titleEntry = entry('@deepseek-ai/dsh-session-title')
    if (titleEntry === undefined) throw new Error('real Loader composition did not create the title entry')
    await context.loader.update(titleEntry.id, { disabled: true })
    await context.loader.await()
    expect(context.get('sessionTitle')).toBeUndefined()
    expect(context.get('fleet')).toBeDefined()
    expect(context.tools.schemas()).toHaveLength(5)
    expect(context.fleet.list().find(view => view.sessionId === 'loader-target')).not.toHaveProperty('title')

    await context.loader.update(titleEntry.id, { disabled: false })
    await context.loader.await()
    expect(context.get('sessionTitle')).toBeDefined()
    expect(context.fleet.list().find(view => view.sessionId === 'loader-target')).toEqual(
      expect.objectContaining({ title: 'Loader title' }),
    )

    const consumer = entry('@wha1echai/dsh-supervisor/tool')
    if (consumer === undefined) throw new Error('real Loader composition did not create the Consumer entry')
    await context.loader.update(consumer.id, { disabled: true })
    await context.loader.await()
    expect(context.tools.schemas()).toEqual([])
    expect(context.get('fleet')).toBeDefined()
    await context.loader.update(consumer.id, { disabled: false })
    await context.loader.await()
    expect(context.tools.schemas()).toHaveLength(5)
    detachTarget()
    detachCaller()

    const provider = entry('@wha1echai/dsh-supervisor')
    if (provider === undefined) throw new Error('real Loader composition did not create the Provider entry')
    await context.loader.update(provider.id, { disabled: true })
    await context.loader.await()
    expect(context.get('fleet')).toBeUndefined()
    expect(context.tools.schemas()).toEqual([])
    expect(consumer.fiber?.store).toBeUndefined()

    const stale = await context.tools.execute({
      callId: CallId('loader-stale-list'),
      name: 'fleet_list',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(stale.isError).toBe(true)
    expect(stale.isError && stale.error.info?.code).toBe('UNKNOWN_TOOL')
  })

  it('loads the built Fleet entries without the optional title service', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-loader-no-title-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: system-prompt',
      "  name: '@deepseek-ai/dsh-system-prompt'",
      '- id: tools',
      "  name: '@deepseek-ai/dsh-tools'",
      '- id: agents',
      "  name: '@deepseek-ai/dsh-agent'",
      '- id: supervisor',
      "  name: '@wha1echai/dsh-supervisor'",
      '- id: supervisor-tools',
      "  name: '@wha1echai/dsh-supervisor/tool'",
      '  config:',
      '    controlMode: full',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-system-prompt') return SystemPrompt
        if (specifier === '@deepseek-ai/dsh-tools') return ToolRuntime
        if (specifier === '@deepseek-ai/dsh-agent') return AgentRegistry
        if (specifier === '@wha1echai/dsh-supervisor') return import('@wha1echai/dsh-supervisor')
        if (specifier === '@wha1echai/dsh-supervisor/tool') return import('@wha1echai/dsh-supervisor/tool')
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('sessionTitle')).toBeUndefined()
    expect(context.get('fleet')).toBeDefined()
    expect(context.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'fleet_cancel', 'fleet_inspect', 'fleet_list', 'fleet_send', 'fleet_steer',
    ])
    const detach = registerRoot('no-title-root')
    expect(context.fleet.list()[0]).not.toHaveProperty('title')
    detach()
  })
})
