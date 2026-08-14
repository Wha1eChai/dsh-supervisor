import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { FleetDeliveryId, FleetReplyReceipt } from './relay.js'

/** Filters applied to the process-local live-agent listing. */
export interface FleetListFilter {
  rootsOnly?: boolean
  runningOnly?: boolean
}

/** Options controlling the transcript tail returned by inspect. */
export interface FleetInspectOptions {
  tailMessages?: number
}

/** Caller identity used to reject self-directed writes. */
export interface FleetCallerOptions {
  callerSessionId?: string
}

/** Exact live caller capability required for Provider-owned target confirmation. */
export interface FleetRequiredCallerOptions {
  /** Exact Agent object supplied by the owning ToolRuntime execution. */
  callerAgent: Agent
  /** Session id used only to locate and cross-check the exact Agent object. */
  callerSessionId: string
}

/** Filters and caller identity for issuing short-lived target references. */
export interface FleetTargetListOptions extends FleetListFilter, FleetRequiredCallerOptions {}

/** Options for canceling one root agent. */
export interface FleetCancelOptions extends FleetCallerOptions {
  keepInbox?: boolean
}

/** Whether Fleet can write to one live agent and through which seam. */
export type FleetControl = 'direct' | 'subagent' | 'observe-only'

/** AgentRegistry runtime ownership classification of one live agent. */
export type FleetAgentKind = 'root' | 'delegated'

/** JSON-safe projection of one process-local live agent. */
export interface FleetAgentView {
  sessionId: string
  status: AgentStatus
  /** AgentRegistry runtime ownership, independent of durable Session lineage. */
  kind: FleetAgentKind
  control: FleetControl
  /** Latest logged title, when the optional session-title service is available. */
  title?: string
  /** Durable Session lineage metadata, independent of runtime ownership. */
  parentSessionId?: string
  cwd?: string
  blank: boolean
  queueCount: number
  updatedAt?: number
}

/** Narrow durable attribution projected for one Fleet relay message. */
export interface FleetRelayView {
  version: 1
  form: 'relay'
  senderSessionId: string
  deliveryId: FleetDeliveryId
}

/** One plain-text user or assistant message summary. */
export interface FleetMessageSummary {
  messageId: string
  role: 'user' | 'assistant'
  text: string
  /** Whether this message's text exceeded the configured per-message limit. */
  textTruncated: boolean
  /** Structured attribution when the message was created by a selected Fleet write. */
  relay?: FleetRelayView
}

/** JSON-safe detailed projection of one process-local live agent. */
export interface FleetInspectView extends FleetAgentView {
  /** Number of eligible user/assistant messages omitted by the tail bound. */
  omittedMessages: number
  tailMessages: FleetMessageSummary[]
}

/** Caller-bound short-lived reference to one exact live target. */
export interface FleetTargetView extends FleetAgentView {
  targetRef: string
  targetRefExpiresAt: number
}

/** Single-attempt write authorization issued after target inspection. */
export interface FleetSelectionView {
  handle: string
  expiresAt: number
}

/** Inspected target plus an optional write selection when current policy permits it. */
export interface FleetTargetInspectView {
  agent: FleetInspectView
  selection?: FleetSelectionView
}

/** Options for inspecting one caller-bound target reference. */
export interface FleetTargetInspectOptions extends FleetInspectOptions, FleetRequiredCallerOptions {}

/** Required caller identity for one selected message write. */
export interface FleetSelectedWriteOptions extends FleetRequiredCallerOptions {}

/** JSON-safe receipt for one accepted selected message delivery. */
export interface FleetDeliveryReceipt {
  sessionId: string
  messageId: string
  deliveryId: FleetDeliveryId
}

/** Receipt for one selected follow-up whose owning turn can be observed later. */
export interface FleetSendReceipt extends FleetDeliveryReceipt {
  /** Caller-bound single-observer capability accepted by `waitForReply`. */
  replyReceipt: FleetReplyReceipt
  /** Last time a caller may begin observing this reply. */
  replyReceiptExpiresAt: number
}

/** Exact caller identity and cancellation for one reply observation. */
export interface FleetReplyWaitOptions extends FleetRequiredCallerOptions {
  /** Cancels only this observation; it never cancels or steers the target Agent. */
  signal?: AbortSignal
}

/** One bounded text-bearing assistant message from the claimed turn. */
export interface FleetReplyMessage {
  messageId: string
  step: number
  text: string
  textTruncated: boolean
}

interface FleetReplyResultBase {
  sessionId: string
  messageId: string
  deliveryId: FleetDeliveryId
  assistantMessages: FleetReplyMessage[]
  omittedAssistantMessages: number
}

/** Turn-level result for the exact turn that claimed a selected Fleet follow-up. */
export type FleetReplyResult = (FleetReplyResultBase & {
  outcome: 'turn-ended'
  turn: number
  /** Whether the original relay message itself entered the durable turn surface. */
  admitted: boolean
  turnEndReason: TurnEndReason
}) | (FleetReplyResultBase & {
  outcome: 'discarded'
  assistantMessages: []
  omittedAssistantMessages: 0
}) | (FleetReplyResultBase & {
  outcome: 'target-unavailable'
  /** Present when the relay was claimed before the exact target disappeared. */
  turn?: number
  admitted: boolean
})

/** Options for canceling through one confirmed target selection. */
export interface FleetSelectedCancelOptions extends FleetRequiredCallerOptions {
  keepInbox?: boolean
}

/** Fleet event names derived from the public Agent lifecycle stream. */
export type FleetEventType = 'created' | 'status' | 'disposed'

/** JSON-safe lifecycle notification emitted by a Fleet provider. */
export interface FleetEvent {
  type: FleetEventType
  agent: FleetAgentView
}

/** Stable Fleet failure codes for consumers and future transports. */
export type FleetErrorCode =
  | 'fleet-unavailable'
  | 'fleet-not-found'
  | 'fleet-self-target'
  | 'fleet-delegated-write-deferred'
  | 'fleet-observe-only'
  | 'fleet-empty-text'
  | 'fleet-caller-unavailable'
  | 'fleet-target-reference-invalid'
  | 'fleet-selection-invalid'
  | 'fleet-reply-invalid'
  | 'fleet-reply-capacity'

/** Error with stable machine-readable Fleet safety metadata. */
export class FleetError extends HarnessError {
  readonly actionTaken = false
  readonly targetSubstitutionAllowed = false
  readonly nextAction = 'relist-or-ask-user' as const

  /**
   * Create one Fleet operation failure.
   * @param code - stable error code.
   * @param message - optional explanatory detail.
   */
  constructor(public override readonly code: FleetErrorCode, message: string = code) {
    super(message, code)
  }
}
