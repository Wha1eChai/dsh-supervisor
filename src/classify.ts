import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { FleetAgentKind, FleetControl } from './types.js'

/** Classify an agent from durable session lineage. */
export function classifyAgent(agent: Agent): FleetAgentKind {
  const header = agent.session.header
  return header.origin === 'subagent' || header.parentSession !== undefined
    ? 'delegated'
    : 'root'
}

/** Resolve the available control path without importing a concrete provider. */
export function resolveControl(ctx: Context, kind: FleetAgentKind): FleetControl {
  if (kind === 'root') return 'direct'
  return ctx.get('subagents') === undefined ? 'observe-only' : 'subagent'
}
