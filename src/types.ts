import type { AgentStatus } from '@deepseek-ai/dsh-agent'

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

/** Options for canceling one root agent. */
export interface FleetCancelOptions extends FleetCallerOptions {
  keepInbox?: boolean
}

/** Whether Fleet can write to one live agent and through which seam. */
export type FleetControl = 'direct' | 'subagent' | 'observe-only'

/** Product classification of one live agent. */
export type FleetAgentKind = 'root' | 'delegated'

/** JSON-safe projection of one process-local live agent. */
export interface FleetAgentView {
  sessionId: string
  status: AgentStatus
  kind: FleetAgentKind
  control: FleetControl
  parentSessionId?: string
  cwd?: string
  blank: boolean
  queueCount: number
  updatedAt?: number
}

/** One plain-text user or assistant message summary. */
export interface FleetMessageSummary {
  messageId: string
  role: 'user' | 'assistant'
  text: string
}

/** JSON-safe detailed projection of one process-local live agent. */
export interface FleetInspectView extends FleetAgentView {
  tailMessages: FleetMessageSummary[]
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

/** Error with a stable machine-readable Fleet code. */
export class FleetError extends Error {
  override readonly name = 'FleetError'

  /**
   * Create one Fleet operation failure.
   * @param code - stable error code.
   * @param message - optional explanatory detail.
   */
  constructor(public readonly code: FleetErrorCode, message: string = code) {
    super(message)
  }
}
