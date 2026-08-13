import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { FleetAgentKind, FleetControl } from './types.js'

/**
 * Classify one live Agent by exact membership in an AgentRegistry root snapshot.
 * @param agent - exact live Agent object to classify.
 * @param roots - exact live root objects returned by `ctx.agents.roots()`.
 * @returns the AgentRegistry runtime ownership classification.
 */
export function classifyAgent(agent: Agent, roots: ReadonlySet<Agent>): FleetAgentKind {
  return roots.has(agent) ? 'root' : 'delegated'
}

/** Resolve the available control path without importing a concrete provider. */
export function resolveControl(ctx: Context, kind: FleetAgentKind): FleetControl {
  if (kind === 'root') return 'direct'
  return ctx.get('subagents') === undefined ? 'observe-only' : 'subagent'
}
