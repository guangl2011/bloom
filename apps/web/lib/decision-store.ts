/**
 * In-memory decision store — the local mock path for approval decisions while
 * the approval service (D3f) is not wired. Decisions live for the life of the
 * server process; a restart drops them, which is exactly right for a mock
 * that must never claim to have executed anything.
 *
 * The real persistence (approval + audit tables) lands with D3f — this store
 * never pretends to be it.
 */

export interface DecisionRecord {
  id: string
  approved: boolean
  approver: string
  decidedAt: string
  note?: string
}

const decisions = new Map<string, DecisionRecord>()

export class UnknownApprovalError extends Error {
  constructor(id: string) {
    super(`unknown approval request: ${id}`)
    this.name = 'UnknownApprovalError'
  }
}

export class AlreadyDecidedError extends Error {
  constructor(id: string) {
    super(`approval already decided: ${id}`)
    this.name = 'AlreadyDecidedError'
  }
}

export function getDecision(id: string): DecisionRecord | undefined {
  return decisions.get(id)
}

export function listDecisions(): DecisionRecord[] {
  return [...decisions.values()]
}

/** Records a decision; throws on unknown or already-decided requests. */
export function decide(id: string, input: { approved: boolean; approver: string; note?: string }): DecisionRecord {
  if (decisions.has(id)) throw new AlreadyDecidedError(id)
  const record: DecisionRecord = {
    id,
    approved: input.approved,
    approver: input.approver,
    decidedAt: new Date().toISOString(),
    note: input.note,
  }
  decisions.set(id, record)
  return record
}

/** Test isolation only. */
export function resetDecisions(): void {
  decisions.clear()
}
