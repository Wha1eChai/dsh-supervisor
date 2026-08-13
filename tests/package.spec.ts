import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as plugin from '../src/index.js'

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

  it('schema supplies defaults and validates positive integers', () => {
    expect(plugin.Config()).toEqual({
      defaultTailMessages: 8,
      maxTailMessages: 32,
      maxMessageTextChars: 2000,
    })
    expect(() => plugin.Config({
      defaultTailMessages: 0, maxTailMessages: 32, maxMessageTextChars: 2000,
    })).toThrow()
    expect(() => plugin.Config({
      defaultTailMessages: 1.5, maxTailMessages: 32, maxMessageTextChars: 2000,
    })).toThrow()
    expect(() => plugin.Config({
      defaultTailMessages: 8, maxTailMessages: -1, maxMessageTextChars: 2000,
    })).toThrow()
    expect(() => plugin.Config({
      defaultTailMessages: 8, maxTailMessages: 32, maxMessageTextChars: 0,
    })).toThrow()
    expect(() => plugin.Config({
      defaultTailMessages: 8, maxTailMessages: 32, maxMessageTextChars: Number.MAX_VALUE,
    })).toThrow()
  })
})
