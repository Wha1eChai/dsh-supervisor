import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  FleetAgentView,
  FleetCallerOptions,
  FleetCancelOptions,
  FleetEvent,
  FleetInspectOptions,
  FleetInspectView,
  FleetListFilter,
  FleetSelectedCancelOptions,
  FleetSelectedWriteOptions,
  FleetTargetInspectOptions,
  FleetTargetInspectView,
  FleetTargetListOptions,
  FleetTargetView,
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

  /**
   * Issue caller-bound references for live targets.
   * @param options - owning caller identity and optional live-target filters.
   * @returns JSON-safe target views with expiring opaque references.
   */
  abstract listTargets(options: FleetTargetListOptions): FleetTargetView[]

  /**
   * Inspect one target reference and issue a write selection when current policy permits it.
   * @param targetRef - opaque caller-bound reference returned by `listTargets`.
   * @param options - owning caller identity and transcript bound.
   * @returns the inspected Agent view and an optional single-attempt selection.
   */
  abstract inspectTarget(targetRef: string, options: FleetTargetInspectOptions): FleetTargetInspectView

  /**
   * Queue a follow-up through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param text - non-empty follow-up text.
   * @param options - owning caller identity.
   * @returns exact target Session identity and created message identity.
   */
  abstract sendSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): { sessionId: string; messageId: string }

  /**
   * Submit steering through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param text - non-empty steering text.
   * @param options - owning caller identity.
   * @returns exact target Session identity and created message identity.
   */
  abstract steerSelected(
    selectionHandle: string,
    text: string,
    options: FleetSelectedWriteOptions,
  ): { sessionId: string; messageId: string }

  /**
   * Cancel through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param options - owning caller identity and optional inbox preservation.
   * @returns exact target Session identity and accepted cancellation state.
   */
  abstract cancelSelected(
    selectionHandle: string,
    options: FleetSelectedCancelOptions,
  ): { sessionId: string; accepted: true }

  /** Subscribe to isolated lifecycle notifications; throws `fleet-unavailable` after unload. */
  abstract subscribe(listener: (event: FleetEvent) => void | Promise<void>): () => void
}
