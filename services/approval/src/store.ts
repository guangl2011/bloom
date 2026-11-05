/**
 * In-memory ApprovalStore — deterministic, dependency-free, and the zero-
 * network default for tests and single-process v1.0 wiring. SQL persistence
 * over the data layer swaps in behind the same interface (services/approval
 * owns the port; the data-layer integration owns the SQL implementation).
 */

import { randomUUID } from 'node:crypto'
import type { GateAction } from '@bloom/interfaces'
import type {
  ApprovalStore,
  AuditEntry,
  GateDecisionRecord,
  GateRequestRecord,
} from './types'

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly requests = new Map<string, GateRequestRecord>()
  private readonly decisions = new Map<string, GateDecisionRecord[]>()
  private readonly audit = new Map<string, AuditEntry[]>()

  async saveRequest(record: GateRequestRecord): Promise<void> {
    this.requests.set(record.id, { ...record })
  }

  async getRequest(id: string, workspaceId: string): Promise<GateRequestRecord | undefined> {
    const record = this.requests.get(id)
    return record && record.workspaceId === workspaceId ? record : undefined
  }

  /**
   * Latest request with the same workspace, action, requester and payload
   * fingerprint whose state still answers a re-request — pending, approved
   * or denied. Denied sticks: the same payload is never re-asked. An expired
   * record does not match — re-requesting after expiry opens a fresh cycle
   * with a new deadline for the human.
   */
  async findEquivalent(input: {
    workspaceId: string
    action: GateAction
    payloadFingerprint: string
    requestedBy: string
  }): Promise<GateRequestRecord | undefined> {
    let latest: GateRequestRecord | undefined
    for (const record of this.requests.values()) {
      if (
        record.state !== 'expired' &&
        record.workspaceId === input.workspaceId &&
        record.action === input.action &&
        record.payloadFingerprint === input.payloadFingerprint &&
        record.requestedBy === input.requestedBy
      ) {
        latest = record
      }
    }
    return latest
  }

  async allRequests(): Promise<readonly GateRequestRecord[]> {
    return [...this.requests.values()]
  }

  async saveDecision(record: GateDecisionRecord): Promise<void> {
    const existing = this.decisions.get(record.requestId) ?? []
    this.decisions.set(record.requestId, [...existing, { ...record }])
  }

  async listDecisions(requestId: string, workspaceId: string): Promise<readonly GateDecisionRecord[]> {
    const all = this.decisions.get(requestId) ?? []
    return all.filter((decision) => decision.workspaceId === workspaceId)
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    const existing = this.audit.get(entry.workspaceId) ?? []
    this.audit.set(entry.workspaceId, [...existing, entry])
  }

  async listAudit(workspaceId: string): Promise<readonly AuditEntry[]> {
    return this.audit.get(workspaceId) ?? []
  }
}

export function newGateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}
