/**
 * The P0 approval gate (spec locked decision 10): every high-risk action
 * requires a recorded human decision before execution. Hard invariant —
 * enforced here and CI-tested, never config-off.
 *
 * Execution path: an agent submits a request → a human decides in the
 * approval console → the gated adapter calls `authorize` with the decision id
 * and the identity fields it is about to act on. The gate refuses unless a
 * valid, unconsumed, unexpired approval covers those exact fields — and every
 * request, decision, expiry, refusal and allowance lands in the audit trail
 * with the workspace id.
 */

import type {
  ApprovalInterface,
  ApprovalDecision,
  ApprovalRequest,
} from '@bloom/interfaces'
import { bindingMatches, fingerprintPayload } from './fingerprint'
import { InMemoryApprovalStore, newGateId } from './store'
import type {
  ApprovalStore,
  AuditEntry,
  AuditEventName,
  GateAuthorizeInput,
  GateAuthorizeResult,
  GateDecideInput,
  GateDecisionRecord,
  GateRefusalReason,
  GateRequestRecord,
  GateSubmitInput,
} from './types'
import { ApprovalGateError } from './types'

export * from './types'
export { bindingMatches, canonicalJson, fingerprintPayload } from './fingerprint'
export { InMemoryApprovalStore, newGateId } from './store'

export interface ApprovalGateOptions {
  /** Injectable clock — deterministic expiry tests. */
  readonly now?: () => Date
  readonly store?: ApprovalStore
  /** Request TTL: a pending request older than this is expired (default 24h). */
  readonly requestTtlMs?: number
  /** Approval token validity: one execution, before this deadline (default 1h). */
  readonly approvalValidityMs?: number
}

export interface ApprovalGate {
  /** Creates a new request record — always a fresh record, even for repeats. */
  submit(input: GateSubmitInput): Promise<GateRequestRecord>
  /** Records a human decision. Approving or denying a non-pending request records a `rejected` outcome. */
  decide(input: GateDecideInput): Promise<GateDecisionRecord>
  /** Pre-execution check gated adapters call — refuses and audits every failure mode. */
  authorize(input: GateAuthorizeInput): Promise<GateAuthorizeResult>
  /** Marks pending requests past their expiry; returns how many were expired. */
  sweepExpired(): Promise<number>
  /** Full audit trail for a workspace, oldest first. */
  listAudit(workspaceId: string): Promise<readonly AuditEntry[]>
  /** Approval-console queue: live pending requests for a workspace. */
  listPending(workspaceId: string): Promise<readonly GateRequestRecord[]>
  /**
   * The four-interface `ApprovalInterface` view for agent contexts, bound to
   * one workspace. `request` dedupes on (workspace, action, requester,
   * payload fingerprint): a re-run reuses the still-pending record instead of
   * stacking duplicates. A pending record is reported as `approved: false` —
   * the send stays queued until the decision exists; once approved, the same
   * request returns the recorded decision and the adapter re-verifies it.
   */
  asApprovalInterface(workspaceId: string): ApprovalInterface
}

const DEFAULT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_APPROVAL_VALIDITY_MS = 60 * 60 * 1000

export function createApprovalGate(options: ApprovalGateOptions = {}): ApprovalGate {
  const now = options.now ?? (() => new Date())
  const store = options.store ?? new InMemoryApprovalStore()
  const requestTtlMs = options.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS
  const approvalValidityMs = options.approvalValidityMs ?? DEFAULT_APPROVAL_VALIDITY_MS

  function iso(time: Date): string {
    return time.toISOString()
  }

  async function audit(
    workspaceId: string,
    event: AuditEventName,
    actor: string,
    requestId: string | undefined,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await store.appendAudit({
      id: newGateId('aud'),
      workspaceId,
      at: iso(now()),
      event,
      actor,
      ...(requestId === undefined ? {} : { requestId }),
      detail,
    })
  }

  /** Expires a pending record past its TTL — first-class outcome, audited. */
  async function sweepRecord(record: GateRequestRecord): Promise<GateRequestRecord> {
    if (record.state === 'pending' && now().getTime() >= Date.parse(record.expiresAt)) {
      const expired: GateRequestRecord = { ...record, state: 'expired' }
      await store.saveRequest(expired)
      await audit(record.workspaceId, 'gate.expired', 'approval-gate', record.id, {
        action: record.action,
        expiredAt: iso(now()),
      })
      return expired
    }
    return record
  }

  const gate: ApprovalGate = {
    async submit(input: GateSubmitInput): Promise<GateRequestRecord> {
      const at = now()
      const record: GateRequestRecord = {
        id: newGateId('req'),
        workspaceId: input.workspaceId,
        action: input.action,
        reason: input.reason,
        requestedBy: input.requestedBy,
        ...(input.skill === undefined ? {} : { skill: input.skill }),
        payload: input.payload,
        payloadFingerprint: fingerprintPayload(input.payload),
        createdAt: iso(at),
        expiresAt: iso(new Date(at.getTime() + (input.ttlMs ?? requestTtlMs))),
        state: 'pending',
      }
      await store.saveRequest(record)
      await audit(input.workspaceId, 'gate.requested', input.requestedBy, record.id, {
        action: input.action,
        reason: input.reason,
        payloadFingerprint: record.payloadFingerprint,
        expiresAt: record.expiresAt,
      })
      return record
    },

    async decide(input: GateDecideInput): Promise<GateDecisionRecord> {
      if (input.approver.trim() === '') {
        throw new ApprovalGateError('request_not_found', 'decision requires a named approver')
      }
      const current = await store.getRequest(input.requestId, input.workspaceId)
      if (!current) {
        throw new ApprovalGateError(
          'request_not_found',
          `no approval request ${input.requestId} in workspace ${input.workspaceId}`,
        )
      }
      const record = await sweepRecord(current)
      const decidedAt = iso(now())

      if (record.state !== 'pending') {
        const rejected: GateDecisionRecord = {
          id: newGateId('dec'),
          requestId: record.id,
          workspaceId: input.workspaceId,
          outcome: 'rejected',
          approver: input.approver,
          decidedAt,
          ...(input.note === undefined ? {} : { note: input.note }),
        }
        await store.saveDecision(rejected)
        await audit(input.workspaceId, 'gate.decision_rejected', input.approver, record.id, {
          attemptedOutcome: input.outcome,
          currentState: record.state,
        })
        return rejected
      }

      const approved = input.outcome === 'approve'
      const decision: GateDecisionRecord = {
        id: newGateId('dec'),
        requestId: record.id,
        workspaceId: input.workspaceId,
        outcome: approved ? 'approved' : 'denied',
        approver: input.approver,
        decidedAt,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(approved ? { validUntil: iso(new Date(now().getTime() + (input.validityMs ?? approvalValidityMs))) } : {}),
      }
      await store.saveDecision(decision)
      const next: GateRequestRecord = { ...record, state: approved ? 'approved' : 'denied' }
      await store.saveRequest(next)
      await audit(input.workspaceId, 'gate.decision', input.approver, record.id, {
        outcome: decision.outcome,
        ...(input.note === undefined ? {} : { note: input.note }),
      })
      return decision
    },

    async authorize(input: GateAuthorizeInput): Promise<GateAuthorizeResult> {
      const refusal = async (reason: GateRefusalReason): Promise<GateAuthorizeResult> => {
        const error = `approval gate refused ${input.action} (decision ${input.decisionId}): ${reason}`
        await audit(input.workspaceId, 'gate.authorize.refused', 'approval-gate', input.decisionId, {
          action: input.action,
          reason,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
        })
        return { ok: false, reason, error }
      }

      const record = await store.getRequest(input.decisionId, input.workspaceId)
      if (!record) {
        return refusal('not_found')
      }
      if (record.action !== input.action) {
        return refusal('action_mismatch')
      }
      const swept = await sweepRecord(record)
      if (swept.state === 'expired') {
        return refusal('expired')
      }
      if (swept.state === 'pending') {
        return refusal('pending')
      }
      if (swept.state === 'denied') {
        return refusal('denied')
      }

      const decisions = await store.listDecisions(record.id, input.workspaceId)
      const decision = decisions.at(-1)
      if (!decision) {
        return refusal('no_decision')
      }
      if (decision.outcome !== 'approved') {
        return refusal(decision.outcome === 'denied' ? 'denied' : 'expired')
      }
      if (decision.consumedAt !== undefined) {
        return refusal('already_used')
      }
      if (decision.validUntil !== undefined && now().getTime() >= Date.parse(decision.validUntil)) {
        return refusal('expired')
      }
      if (input.binding !== undefined && !bindingMatches(input.binding, record.payload)) {
        return refusal('binding_mismatch')
      }

      await store.saveDecision({ ...decision, consumedAt: iso(now()) })
      await audit(input.workspaceId, 'gate.authorize.allowed', 'approval-gate', record.id, {
        action: input.action,
        decisionId: decision.id,
        approver: decision.approver,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
      })
      return {
        ok: true,
        requestId: record.id,
        approver: decision.approver,
        decidedAt: decision.decidedAt,
      }
    },

    async sweepExpired(): Promise<number> {
      let count = 0
      for (const record of await store.allRequests()) {
        const swept = await sweepRecord(record)
        if (swept.state === 'expired' && record.state === 'pending') {
          count += 1
        }
      }
      return count
    },

    async listAudit(workspaceId: string): Promise<readonly AuditEntry[]> {
      return store.listAudit(workspaceId)
    },

    async listPending(workspaceId: string): Promise<readonly GateRequestRecord[]> {
      const pending: GateRequestRecord[] = []
      for (const record of await store.allRequests()) {
        const swept = await sweepRecord(record)
        if (swept.workspaceId === workspaceId && swept.state === 'pending') {
          pending.push(swept)
        }
      }
      return pending
    },

    asApprovalInterface(workspaceId: string): ApprovalInterface {
      return {
        async request(request: ApprovalRequest): Promise<ApprovalDecision> {
          const fingerprint = fingerprintPayload(request.payload)
          const equivalent = await store.findEquivalent({
            workspaceId,
            action: request.action,
            payloadFingerprint: fingerprint,
            requestedBy: request.requestedBy,
          })
          if (equivalent) {
            const record = await sweepRecord(equivalent)
            await audit(workspaceId, 'gate.revisit', request.requestedBy, record.id, {
              action: request.action,
            })
            return decisionFor(record)
          }
          const record = await gate.submit({
            workspaceId,
            action: request.action,
            reason: request.reason,
            requestedBy: request.requestedBy,
            ...(request.skill === undefined ? {} : { skill: request.skill }),
            payload: request.payload,
          })
          return decisionFor(record)
        },
      }
    },
  }

  /** Current decision view of a request record — pending never reads as approved. */
  async function decisionFor(record: GateRequestRecord): Promise<ApprovalDecision> {
    const base = { decisionId: record.id, action: record.action }
    if (record.state === 'pending') {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'pending human decision' }
    }
    const decisions = await store.listDecisions(record.id, record.workspaceId)
    const decision = decisions.at(-1)
    if (record.state === 'denied') {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'denied' }
    }
    if (record.state === 'expired') {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'expired' }
    }
    if (!decision || decision.outcome !== 'approved') {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'no recorded approval' }
    }
    if (decision.consumedAt !== undefined) {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'approval already used' }
    }
    if (decision.validUntil !== undefined && now().getTime() >= Date.parse(decision.validUntil)) {
      return { ...base, approved: false, approver: '', decidedAt: '', note: 'approval expired' }
    }
    return {
      ...base,
      approved: true,
      approver: decision.approver,
      decidedAt: decision.decidedAt,
      ...(decision.note === undefined ? {} : { note: decision.note }),
    }
  }

  return gate
}
