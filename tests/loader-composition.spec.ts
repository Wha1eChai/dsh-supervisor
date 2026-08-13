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
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
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

describe('built package through real Loader composition', () => {
  it('loads both namespace entries, executes a real Fleet tool, and removes stale Consumers', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-loader-'))
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
    expect(context.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'fleet_cancel', 'fleet_inspect', 'fleet_list', 'fleet_send', 'fleet_steer',
    ])

    const listed = await context.tools.execute({
      callId: CallId('loader-fleet-list'),
      name: 'fleet_list',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error(listed.error.message)
    expect(listed.value).toEqual({ agents: [], count: 0 })
    expect(listed.content).toEqual([{ type: 'text', text: 'No live Fleet sessions.' }])

    const consumer = entry('@wha1echai/dsh-supervisor/tool')
    if (consumer === undefined) throw new Error('real Loader composition did not create the Consumer entry')
    await context.loader.update(consumer.id, { disabled: true })
    expect(context.tools.schemas()).toEqual([])
    expect(context.get('fleet')).toBeDefined()

    await context.loader.update(consumer.id, { disabled: false })
    await context.loader.await()
    expect(context.tools.schemas()).toHaveLength(5)

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
})
