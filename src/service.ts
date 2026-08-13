import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  FleetAgentView,
  FleetCallerOptions,
  FleetCancelOptions,
  FleetEvent,
  FleetInspectOptions,
  FleetInspectView,
  FleetListFilter,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleet: FleetService
  }
}

/** Service Definition for process-local Fleet observation and root control. */
export abstract class FleetService extends Service {
  /** Register this provider as `ctx.fleet`. */
  protected constructor(ctx: Context) {
    super(ctx, 'fleet')
  }

  /** List live agents visible to this provider; throws `fleet-unavailable` after unload. */
  abstract list(filter?: FleetListFilter): FleetAgentView[]

  /** Inspect one live agent without exposing runtime objects or raw events; throws `fleet-unavailable` after unload. */
  abstract inspect(sessionId: string, options?: FleetInspectOptions): FleetInspectView

  /** Queue a follow-up for one live root agent; throws `fleet-unavailable` after unload. */
  abstract send(sessionId: string, text: string, options?: FleetCallerOptions): { messageId: string }

  /** Submit steering for one live root agent; throws `fleet-unavailable` after unload. */
  abstract steer(sessionId: string, text: string, options?: FleetCallerOptions): { messageId: string }

  /** Cancel one live root agent; throws `fleet-unavailable` after unload. */
  abstract cancel(sessionId: string, options?: FleetCancelOptions): { accepted: true }

  /** Subscribe to isolated lifecycle notifications; throws `fleet-unavailable` after unload. */
  abstract subscribe(listener: (event: FleetEvent) => void | Promise<void>): () => void
}
