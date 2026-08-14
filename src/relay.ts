import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Opaque Provider-issued correlation identity for one Fleet relay delivery. */
export type FleetDeliveryId = Branded<'FleetDeliveryId'>

/** Versioned durable attribution for a confirmed Fleet message relay. */
export interface FleetRelayMessageSource {
  readonly kind: 'fleet-relay'
  readonly version: 1
  readonly form: 'relay'
  /** Exact Session id of the Agent that owned the selected write. */
  readonly senderSessionId: SessionId
  /** Provider-generated correlation identity; never an authorization credential. */
  readonly deliveryId: FleetDeliveryId
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'fleet-relay': FleetRelayMessageSource
  }
}
