/**
 * ApprovalInterface — every external action passes through a recorded human
 * decision before execution (spec locked decision 10: a hard invariant, never
 * config-off).
 */

import type { AgentId, GateAction } from './ids'

export interface ApprovalRequest {
  action: GateAction
  /** Human-readable reason the gate is being hit; lands in the audit trail. */
  reason: string
  /** Agent requesting the gate action — the audit trail records who asked. */
  requestedBy: AgentId
  /** Skill and version that produced the request (versioned prompts, PRD §6). */
  skill?: {
    readonly name: string
    readonly version: number
  }
  /** Estimated cost, when the gate exists to price the action (high_cost_model_call). */
  costEstimate?: number
  payload?: unknown
}

export interface ApprovalDecision {
  /** Audit-trail id of this decision — downstream tools require it to execute. */
  decisionId: string
  action: GateAction
  approved: boolean
  /** Who decided — a named approver from the intake contract, never a role placeholder. */
  approver: string
  decidedAt: string
  note?: string
}

/** Every external action crosses this gate; decisions are audit-logged. */
export interface ApprovalInterface {
  request(request: ApprovalRequest): Promise<ApprovalDecision>
}
