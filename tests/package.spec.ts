import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as plugin from '../src/index.js'
import * as replyJobPlugin from '../src/reply-job.js'
import * as toolPlugin from '../src/tool.js'

describe('package entry point', () => {
  it('declares the optional rc.6 session-title peer without changing exports', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional?: boolean }>
      exports: Record<string, unknown>
      dsh: { bundle: { patch: string } }
    }
    expect(packageJson.peerDependencies['@deepseek-ai/dsh-brand']).toBe('0.1.0-rc.6')
    expect(packageJson.peerDependencies['@deepseek-ai/dsh-jobs']).toBe('0.1.0-rc.6')
    expect(packageJson.peerDependencies['@deepseek-ai/dsh-session-title']).toBe('0.1.0-rc.6')
    expect(packageJson.peerDependenciesMeta['@deepseek-ai/dsh-jobs']).toEqual({ optional: true })
    expect(packageJson.peerDependenciesMeta['@deepseek-ai/dsh-session-title']).toEqual({ optional: true })
    expect(packageJson.exports).toMatchObject({
      '.': expect.any(Object),
      './tool': expect.any(Object),
      './reply-job': expect.any(Object),
    })
    expect(packageJson.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')).toBe([
      '- insert:',
      '    - id: dsh-supervisor',
      "      name: '@wha1echai/dsh-supervisor'",
      '',
    ].join('\n'))
  })

  it('keeps the Loader-safe namespace plugin shape', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('dsh-supervisor')
    expect(unwrapped.inject).toEqual(['agents'])
    expect(unwrapped.Config).toBe(plugin.Config)
    expect(unwrapped.apply).toBe(plugin.apply)
    expect(plugin.FleetService).toBeTypeOf('function')
    expect(plugin.InProcessFleetProvider).toBeTypeOf('function')
    expect('FleetRelayMessageSource' in plugin).toBe(false)
    expect('FleetReplyReceipt' in plugin).toBe(false)
  })

  it('keeps the tool subpath namespace Loader-safe', () => {
    expect('default' in toolPlugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolPlugin) as Record<string, unknown>
    expect(unwrapped).toBe(toolPlugin)
    expect(unwrapped.name).toBe('tool-dsh-supervisor')
    expect(unwrapped.inject).toEqual(['tools', 'fleet'])
    expect(unwrapped.Config).toBe(toolPlugin.Config)
    expect(unwrapped.apply).toBe(toolPlugin.apply)
  })

  it('keeps the reply-job subpath namespace Loader-safe', () => {
    expect('default' in replyJobPlugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const namespace = replyJobPlugin as unknown as {
      name: string
      inject: string[]
      Config: (value?: unknown) => { maxOutputBytes: number }
      apply: typeof replyJobPlugin.apply
    }
    const unwrapped = loader.unwrapExports(namespace) as Record<string, unknown>
    expect(unwrapped).toBe(namespace)
    expect(unwrapped.name).toBe('tool-dsh-supervisor-reply-job')
    expect(unwrapped.inject).toEqual(['tools', 'fleet'])
    expect(unwrapped.Config).toBe(namespace.Config)
    expect(unwrapped.apply).toBe(replyJobPlugin.apply)
    expect(namespace.Config()).toEqual({ maxOutputBytes: 300_000 })
    expect(() => namespace.Config({ maxOutputBytes: 0 })).toThrow()
  })

  it('schema supplies defaults and validates positive integers', () => {
    expect(plugin.Config()).toEqual({
      defaultTailMessages: 8,
      maxTailMessages: 32,
      maxMessageTextChars: 2000,
      targetRefTtlMs: 300_000,
      selectionTtlMs: 60_000,
      maxSelectionsPerCaller: 32,
      replyReceiptTtlMs: 600_000,
      maxReplyRecordsPerCaller: 32,
      maxReplyMessages: 8,
      maxReplyTextChars: 8000,
    })
    const valid = {
      defaultTailMessages: 8,
      maxTailMessages: 32,
      maxMessageTextChars: 2000,
      targetRefTtlMs: 300_000,
      selectionTtlMs: 60_000,
      maxSelectionsPerCaller: 32,
      replyReceiptTtlMs: 600_000,
      maxReplyRecordsPerCaller: 32,
      maxReplyMessages: 8,
      maxReplyTextChars: 8000,
    }
    for (const invalid of [
      { ...valid, defaultTailMessages: 0 },
      { ...valid, defaultTailMessages: 1.5 },
      { ...valid, maxTailMessages: -1 },
      { ...valid, maxMessageTextChars: 0 },
      { ...valid, maxMessageTextChars: Number.MAX_VALUE },
      { ...valid, targetRefTtlMs: 0 },
      { ...valid, selectionTtlMs: 1.5 },
      { ...valid, maxSelectionsPerCaller: -1 },
      { ...valid, replyReceiptTtlMs: 0 },
      { ...valid, maxReplyRecordsPerCaller: 1.5 },
      { ...valid, maxReplyMessages: 0 },
      { ...valid, maxReplyTextChars: Number.MAX_VALUE },
    ]) {
      expect(() => plugin.Config(invalid)).toThrow()
    }
  })
})
