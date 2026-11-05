/**
 * Approval gate domain types (spec deliverable D3, locked decision 10).
 *
 * The gate is a state machine, not a boolean. Every high-risk action creates a
 * request; a human decision approves or denies it; an unanswered request
 * expires. Denial and expiry are first-class outcomes — execution is refused
 * with a distinct, audited reason for each, never silently collapsed into
 * "not approved".
 */

import type { GateAction } from '@bloom/interfaces'

/** Lifecycle state of an approval request. */
export type GateRequestState = 'pending' | 'approved' | 'denied' | 'expired'

/** A high-risk action awaiting (or holding) a recorded human decision. */
export interface GateRequestRecord {
  readonly id: string
  readonly workspaceId: string
  readonly action: GateAction
  /** Human-readable reason the gate was hit — what the approver sees. */
  readonly reason: string
  /** Agent that asked — the audit trail records who requested the action. */
  readonly requestedBy: string
  /** Skill and version that produced the request (versioned prompts, PRD §6). */
  readonly skill?: { readonly name: string; readonly version: number }
  /** What the requester asked to do; executions bind to these fields. */
  readonly payload: unknown
  /** Canonical fingerprint of the payload — re-request dedupe and binding checks. */
  readonly payloadFingerprint: string
  readonly createdAt: string
  /** A pending request past this point is expired — approving it is refused. */
  readonly expiresAt: string
  state: GateRequestState
}

/** Outcome of a recorded decision. `rejected` = a decision attempt on a request that was no longer pending. */
export type GateDecisionOutcome = 'approved' | 'denied' | 'expired' | 'rejected'

/** The recorded human decision (or refused attempt) for a request. */
export interface GateDecisionRecord {
  readonly id: string
  readonly requestId: string
  readonly workspaceId: string
  readonly outcome: GateDecisionOutcome
  /** Named approver from the intake contract — never a role placeholder. */
  readonly approver: string
  readonly decidedAt: string
  readonly note?: string
  /** Approval token validity end — executions must authorize before this. */
  readonly validUntil?: string
  /** An approval authorizes exactly one execution; set when consumed. */
  consumedAt?: string
}

/** Distinct refusal reasons — each is a different failed precondition, audited separately. */
export type GateRefusalReason =
  | 'not_found'
  | 'action_mismatch'
  | 'pending'
  | 'no_decision'
  | 'denied'
  | 'expired'
  | 'already_used'
  | 'binding_mismatch'

export interface GateAuthorizeInput {
  readonly workspaceId: string
  /** The approval decision id the execution claims — unknown ids are refused. */
  readonly decisionId: string
  readonly action: GateAction
  readonly runId?: string
  /**
   * Identity fields the execution binds to (e.g. email `{ to, subject }`).
   * Every key must exist on the approved request payload with an equal value;
   * a mismatch refuses the execution even with an approved decision.
   */
  readonly binding?: Readonly<Record<string, unknown>>
}

export type GateAuthorizeResult =
  | {
      readonly ok: true
      readonly requestId: string
      readonly approver: string
      readonly decidedAt: string
    }
  | { readonly ok: false; readonly reason: GateRefusalReason; readonly error: string }

/** The minimal gate surface gated adapters depend on (structural, for tests too). */
export interface GateAuthorizer {
  authorize(input: GateAuthorizeInput): Promise<GateAuthorizeResult>
}

export interface GateSubmitInput {
  readonly workspaceId: string
  readonly action: GateAction
  readonly reason: string
  readonly requestedBy: string
  readonly skill?: { readonly name: string; readonly version: number }
  readonly payload?: unknown
  /** Overrides the gate default request TTL. */
  readonly ttlMs?: number
}

export interface GateDecideInput {
  readonly workspaceId: string
  readonly requestId: string
  readonly outcome: 'approve' | 'deny'
  /** Who decided — required; anonymous approvals are refused. */
  readonly approver: string
  readonly note?: string
  /** Overrides the gate default approval validity window. */
  readonly validityMs?: number
}

export const AUDIT_EVENTS = [
  'gate.requested',
  'gate.revisit',
  'gate.decision',
  'gate.decision_rejected',
  'gate.expired',
  'gate.authorize.allowed',
  'gate.authorize.refused',
] as const

export type AuditEventName = (typeof AUDIT_EVENTS)[number]

/** One audit-trail row. Every row carries workspace_id (locked decision 11). */
export interface AuditEntry {
  readonly id: string
  readonly workspaceId: string
  readonly at: string
  readonly event: AuditEventName
  /** Who acted: the requesting agent, the human approver, or the gate itself. */
  readonly actor: string
  readonly requestId?: string
  readonly detail: Readonly<Record<string, unknown>>
}

/** Persistence port — the in-memory implementation backs v1.0; SQL wires in with the data-layer integration. */
export interface ApprovalStore {
  saveRequest(record: GateRequestRecord): Promise<void>
  getRequest(id: string, workspaceId: string): Promise<GateRequestRecord | undefined>
  /**
   * Latest request with the same workspace, action, requester and payload
   * fingerprint whose state still answers a re-request — pending, approved
   * or denied. Denied sticks: the same payload is never re-asked. An expired
   * record does not match — re-requesting after expiry opens a fresh cycle
   * with a new deadline for the human.
   */
  findEquivalent(input: {
    readonly workspaceId: string
    readonly action: GateAction
    readonly payloadFingerprint: string
    readonly requestedBy: string
  }): Promise<GateRequestRecord | undefined>
  allRequests(): Promise<readonly GateRequestRecord[]>
  saveDecision(record: GateDecisionRecord): Promise<void>
  /** Decisions for a request, oldest first. */
  listDecisions(requestId: string, workspaceId: string): Promise<readonly GateDecisionRecord[]>
  appendAudit(entry: AuditEntry): Promise<void>
  listAudit(workspaceId: string): Promise<readonly AuditEntry[]>
}

/** Typed gate failure for callers that need to branch on the code. */
export class ApprovalGateError extends Error {
  constructor(
    public readonly code: 'request_not_found',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalGateError'
  }
}
