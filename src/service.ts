import { Service, type Context } from '@deepseek-ai/cordis'
import type * as FleetTypes from './types.js'

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
  abstract list(filter?: FleetTypes.FleetListFilter): FleetTypes.FleetAgentView[]

  /** Inspect one live agent without exposing runtime objects or raw events; throws `fleet-unavailable` after unload. */
  abstract inspect(sessionId: string, options?: FleetTypes.FleetInspectOptions): FleetTypes.FleetInspectView

  /** Queue a follow-up for one live root agent; throws `fleet-unavailable` after unload. */
  abstract send(sessionId: string, text: string, options?: FleetTypes.FleetCallerOptions): { messageId: string }

  /** Submit steering for one live root agent; throws `fleet-unavailable` after unload. */
  abstract steer(sessionId: string, text: string, options?: FleetTypes.FleetCallerOptions): { messageId: string }

  /** Cancel one live root agent; throws `fleet-unavailable` after unload. */
  abstract cancel(sessionId: string, options?: FleetTypes.FleetCancelOptions): { accepted: true }

  /**
   * Issue caller-bound references for live targets.
   * @param options - exact owning caller Agent and optional live-target filters.
   * @returns JSON-safe target views with expiring opaque references.
   */
  abstract listTargets(options: FleetTypes.FleetTargetListOptions): FleetTypes.FleetTargetView[]

  /**
   * Inspect one target reference and issue a write selection when current policy permits it.
   * @param targetRef - opaque caller-bound reference returned by `listTargets`.
   * @param options - exact owning caller Agent and transcript bound.
   * @returns the inspected Agent view and an optional single-attempt selection.
   */
  abstract inspectTarget(targetRef: string, options: FleetTypes.FleetTargetInspectOptions): FleetTypes.FleetTargetInspectView

  /**
   * Queue a follow-up through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param text - non-empty follow-up text.
   * @param options - exact owning caller Agent.
   * @returns exact target Session identity, created message identity, and opaque delivery identity.
   */
  abstract sendSelected(
    selectionHandle: string,
    text: string,
    options: FleetTypes.FleetSelectedWriteOptions,
  ): FleetTypes.FleetSendReceipt

  /**
   * Observe the complete turn that claims one selected follow-up.
   * @param replyReceipt - caller-bound reply capability returned by `sendSelected`.
   * @param options - exact owning caller Agent and optional cancellation of this observation.
   * @returns one terminal turn-level result; never waits for whole-Agent idle.
   */
  abstract waitForReply(
    replyReceipt: string,
    options: FleetTypes.FleetReplyWaitOptions,
  ): Promise<FleetTypes.FleetReplyResult>

  /**
   * Submit steering through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param text - non-empty steering text.
   * @param options - exact owning caller Agent.
   * @returns exact target Session identity, created message identity, and opaque delivery identity.
   */
  abstract steerSelected(
    selectionHandle: string,
    text: string,
    options: FleetTypes.FleetSelectedWriteOptions,
  ): FleetTypes.FleetDeliveryReceipt

  /**
   * Cancel through one single-attempt confirmed target selection.
   * @param selectionHandle - opaque selection returned by `inspectTarget`.
   * @param options - exact owning caller Agent and optional inbox preservation.
   * @returns exact target Session identity and accepted cancellation state.
   */
  abstract cancelSelected(
    selectionHandle: string,
    options: FleetTypes.FleetSelectedCancelOptions,
  ): { sessionId: string; accepted: true }

  /** Subscribe to isolated lifecycle notifications; throws `fleet-unavailable` after unload. */
  abstract subscribe(listener: (event: FleetTypes.FleetEvent) => void | Promise<void>): () => void
}
