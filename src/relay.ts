import type { Branded } from '@deepseek-ai/dsh-brand'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'

/** Opaque Provider-issued correlation identity for one Fleet relay delivery. */
export type FleetDeliveryId = Branded<'FleetDeliveryId'>

/** Versioned durable attribution for a confirmed Fleet message relay. */
export interface FleetRelayMessageSource {
  readonly kind: 'fleet-relay'
  readonly version: 1
  readonly form: 'relay'
  /** Exact Session id of the Agent that owned the selected write. */
  readonly senderSessionId: SessionIdType
  /** Provider-generated correlation identity; never an authorization credential. */
  readonly deliveryId: FleetDeliveryId
}

const FLEET_DELIVERY_ID_PATTERN = /^fd_[A-Za-z0-9_-]+$/

/**
 * Parse one durable Fleet relay source into its canonical validated fields.
 * @param source - durable or otherwise untrusted message source.
 * @returns validated Fleet relay source, or `undefined` for legacy or malformed data.
 */
export function parseFleetRelaySource(source: unknown): FleetRelayMessageSource | undefined {
  try {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined
    const prototype = Object.getPrototypeOf(source)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const record = source as Record<string, unknown>
    const fields = ['kind', 'version', 'form', 'senderSessionId', 'deliveryId']
    if (Object.keys(record).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(record, field))) return undefined
    const { kind, version, form, senderSessionId: rawSenderSessionId, deliveryId: rawDeliveryId } = record
    if (kind !== 'fleet-relay' || version !== 1 || form !== 'relay') return undefined
    if (typeof rawSenderSessionId !== 'string' || rawSenderSessionId.trim().length === 0) return undefined
    if (typeof rawDeliveryId !== 'string' || !FLEET_DELIVERY_ID_PATTERN.test(rawDeliveryId)) return undefined
    return {
      kind: 'fleet-relay',
      version: 1,
      form: 'relay',
      senderSessionId: SessionId(rawSenderSessionId),
      deliveryId: rawDeliveryId as FleetDeliveryId,
    }
  } catch {
    // A durable source with throwing accessors is not authoritative attribution.
    return undefined
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'fleet-relay': FleetRelayMessageSource
  }
}
