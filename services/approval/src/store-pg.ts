/**
 * SQL-backed ApprovalStore over the gate tables (migrations 0004). Same
 * interface, same invariants as the in-memory store — the compose deployment
 * and the e2e cycle use this one so decisions and audit rows survive restarts.
 */

import type { SqlExecutor } from '@bloom/db'
import type { GateAction } from '@bloom/interfaces'
import type {
  ApprovalStore,
  AuditEntry,
  AuditEventName,
  GateDecisionOutcome,
  GateDecisionRecord,
  GateRequestRecord,
  GateRequestState,
} from './types'

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return String(value)
}

function asRecord<T>(value: unknown): T {
  return value as T
}

interface GateRequestRow {
  id: string
  workspace_id: string
  action: string
  reason: string
  requested_by: string
  requested_at: Date | string
  skill: unknown
  payload: unknown
  payload_fingerprint: string
  expires_at: Date | string
  state: string
}

interface GateDecisionRow {
  id: string
  request_id: string
  workspace_id: string
  outcome: string
  approver: string
  decided_at: Date | string
  note: string | null
  valid_until: Date | string | null
  consumed_at: Date | string | null
}

interface GateAuditRow {
  id: string
  workspace_id: string
  created_at: Date | string
  event: string
  actor: string
  request_id: string | null
  detail: unknown
}

function requestFromRow(row: GateRequestRow): GateRequestRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    action: row.action as GateAction,
    reason: row.reason,
    requestedBy: row.requested_by,
    skill: row.skill ? asRecord(row.skill) : undefined,
    payload: row.payload,
    payloadFingerprint: row.payload_fingerprint,
    createdAt: iso(row.requested_at),
    expiresAt: iso(row.expires_at),
    state: row.state as GateRequestState,
  }
}

function decisionFromRow(row: GateDecisionRow): GateDecisionRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    workspaceId: row.workspace_id,
    outcome: row.outcome as GateDecisionOutcome,
    approver: row.approver,
    decidedAt: iso(row.decided_at),
    note: row.note ?? undefined,
    validUntil: row.valid_until ? iso(row.valid_until) : undefined,
    consumedAt: row.consumed_at ? iso(row.consumed_at) : undefined,
  }
}

export class PgApprovalStore implements ApprovalStore {
  constructor(private readonly exec: SqlExecutor) {}

  async saveRequest(record: GateRequestRecord): Promise<void> {
    await this.exec(
      `INSERT INTO gate_requests
         (id, workspace_id, action, reason, requested_by, requested_at, skill, payload,
          payload_fingerprint, expires_at, state, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $6, $5, $6, $5)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [
        record.id,
        record.workspaceId,
        record.action,
        record.reason,
        record.requestedBy,
        record.createdAt,
        record.skill ? JSON.stringify(record.skill) : null,
        record.payload === undefined ? null : JSON.stringify(record.payload),
        record.payloadFingerprint,
        record.expiresAt,
        record.state,
      ],
    )
  }

  async getRequest(id: string, workspaceId: string): Promise<GateRequestRecord | undefined> {
    const result = await this.exec(
      'SELECT * FROM gate_requests WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL',
      [id, workspaceId],
    )
    const row = result.rows[0] ? asRecord<GateRequestRow>(result.rows[0]) : undefined
    return row ? requestFromRow(row) : undefined
  }

  async findEquivalent(input: {
    readonly workspaceId: string
    readonly action: GateAction
    readonly payloadFingerprint: string
    readonly requestedBy: string
  }): Promise<GateRequestRecord | undefined> {
    // Mirrors the in-memory semantics: latest non-expired equivalent — pending,
    // approved, or denied (denied sticks; expiry opens a fresh cycle).
    const result = await this.exec(
      `SELECT * FROM gate_requests
       WHERE workspace_id = $1 AND action = $2 AND payload_fingerprint = $3
         AND requested_by = $4 AND state <> 'expired' AND deleted_at IS NULL
       ORDER BY requested_at DESC, created_at DESC
       LIMIT 1`,
      [input.workspaceId, input.action, input.payloadFingerprint, input.requestedBy],
    )
    const row = result.rows[0] ? asRecord<GateRequestRow>(result.rows[0]) : undefined
    return row ? requestFromRow(row) : undefined
  }

  async allRequests(): Promise<readonly GateRequestRecord[]> {
    const result = await this.exec(
      'SELECT * FROM gate_requests WHERE deleted_at IS NULL ORDER BY requested_at ASC',
    )
    return result.rows.map((row) => requestFromRow(asRecord<GateRequestRow>(row)))
  }

  async saveDecision(record: GateDecisionRecord): Promise<void> {
    await this.exec(
      `INSERT INTO gate_decisions
         (id, request_id, workspace_id, outcome, approver, decided_at, note, valid_until, consumed_at,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $6, $5, $6, $5)
       ON CONFLICT (id) DO UPDATE SET
         consumed_at = EXCLUDED.consumed_at, updated_at = now()`,
      [
        record.id,
        record.requestId,
        record.workspaceId,
        record.outcome,
        record.approver,
        record.decidedAt,
        record.note ?? null,
        record.validUntil ?? null,
        record.consumedAt ?? null,
      ],
    )
  }

  async listDecisions(requestId: string, workspaceId: string): Promise<readonly GateDecisionRecord[]> {
    const result = await this.exec(
      `SELECT * FROM gate_decisions
       WHERE request_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       ORDER BY decided_at ASC`,
      [requestId, workspaceId],
    )
    return result.rows.map((row) => decisionFromRow(asRecord<GateDecisionRow>(row)))
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.exec(
      `INSERT INTO gate_audit (id, workspace_id, created_at, event, actor, request_id, detail, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $5)`,
      [
        entry.id,
        entry.workspaceId,
        entry.at,
        entry.event,
        entry.actor,
        entry.requestId ?? null,
        entry.detail ? JSON.stringify(entry.detail) : null,
      ],
    )
  }

  async listAudit(workspaceId: string): Promise<readonly AuditEntry[]> {
    const result = await this.exec(
      `SELECT id, workspace_id, created_at, event, actor, request_id, detail
       FROM gate_audit WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY seq ASC`,
      [workspaceId],
    )
    return result.rows.map((row) => {
      const gateRow = asRecord<GateAuditRow>(row)
      return {
        id: gateRow.id,
        workspaceId: gateRow.workspace_id,
        at: iso(gateRow.created_at),
        event: gateRow.event as AuditEventName,
        actor: gateRow.actor,
        requestId: gateRow.request_id ?? undefined,
        detail: gateRow.detail ? asRecord<Record<string, unknown>>(gateRow.detail) : {},
      }
    })
  }
}
