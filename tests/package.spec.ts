import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as plugin from '../src/index.js'
import * as toolPlugin from '../src/tool.js'

describe('package entry point', () => {
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

  it('schema supplies defaults and validates positive integers', () => {
    expect(plugin.Config()).toEqual({
      defaultTailMessages: 8,
      maxTailMessages: 32,
      maxMessageTextChars: 2000,
      targetRefTtlMs: 300_000,
      selectionTtlMs: 60_000,
      maxSelectionsPerCaller: 32,
    })
    const valid = {
      defaultTailMessages: 8,
      maxTailMessages: 32,
      maxMessageTextChars: 2000,
      targetRefTtlMs: 300_000,
      selectionTtlMs: 60_000,
      maxSelectionsPerCaller: 32,
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
    ]) {
      expect(() => plugin.Config(invalid)).toThrow()
    }
  })
})
