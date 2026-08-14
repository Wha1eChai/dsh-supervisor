import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { InProcessFleetProvider } from './providers/in-process.js'

export { classifyAgent, resolveControl } from './classify.js'
export { InProcessFleetProvider } from './providers/in-process.js'
export type { InProcessFleetConfig } from './providers/in-process.js'
export { FleetService } from './service.js'
export * from './types.js'

/** Deployment tunables for the in-process Fleet provider. */
export interface Config {
  defaultTailMessages: number
  maxTailMessages: number
  maxMessageTextChars: number
  targetRefTtlMs: number
  selectionTtlMs: number
  maxSelectionsPerCaller: number
}

const positiveInteger = (defaultValue: number) => Schema.number()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)
  .step(1)
  .default(defaultValue)

/** Schemastery validation and defaults for Fleet deployment tunables. */
export const Config: Schema<Config> = Schema.object({
  defaultTailMessages: positiveInteger(8),
  maxTailMessages: positiveInteger(32),
  maxMessageTextChars: positiveInteger(2000),
  targetRefTtlMs: positiveInteger(300_000),
  selectionTtlMs: positiveInteger(60_000),
  maxSelectionsPerCaller: positiveInteger(32),
})

export const name = 'dsh-supervisor'
export const inject = ['agents']

/** Mount the default replaceable in-process Fleet provider. */
export function apply(ctx: Context, config: Config): void {
  if (config.defaultTailMessages > config.maxTailMessages) {
    throw new Error('dsh-supervisor: defaultTailMessages must be less than or equal to maxTailMessages')
  }
  ctx.plugin(InProcessFleetProvider, config)
}
