/**
 * Real-entry proof: a test-only cordis.yml boots the built package through the
 * official Loader + Include path, then removes the shipped entry again.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'

const builtEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url))
let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('built package through real Loader composition', () => {
  it('loads from cordis.yml with namespace metadata and unloads ctx.fleet', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: agents',
      "  name: '@deepseek-ai/dsh-agent'",
      '- id: supervisor',
      "  name: '@wha1echai/dsh-supervisor'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-agent') return AgentRegistry
        if (specifier === '@wha1echai/dsh-supervisor') {
          return import(pathToFileURL(builtEntry).href)
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
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    const fleet = context.get('fleet')
    if (fleet === undefined) throw new Error('real Loader composition did not provide ctx.fleet')
    expect(typeof fleet.list).toBe('function')
    expect(fleet.list()).toEqual([])

    const supervisor = [...context.loader.entries()]
      .find(entry => entry.options.name === '@wha1echai/dsh-supervisor')
    if (supervisor === undefined) throw new Error('real Loader composition did not create the supervisor entry')
    await context.loader.update(supervisor.id, { disabled: true })
    if (context.get('fleet') !== undefined) {
      throw new Error('disabling the real Loader entry did not remove ctx.fleet')
    }
  })
})
