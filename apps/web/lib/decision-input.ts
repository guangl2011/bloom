/**
 * Input validation for the approval-decision API route. The client's POST
 * body is unknown data — parsed against a discriminated result, never trusted.
 */

export interface DecisionInput {
  id: string
  approved: boolean
  approver: string
  note?: string
}

export type DecisionParseResult = { ok: true; value: DecisionInput } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Pure parser — returns the exact constraint that failed, never a guess. */
export function parseDecisionInput(body: unknown): DecisionParseResult {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' }
  if (!nonEmptyString(body.id)) return { ok: false, error: 'id is required' }
  if (typeof body.approved !== 'boolean') return { ok: false, error: 'approved must be a boolean' }
  if (!nonEmptyString(body.approver)) return { ok: false, error: 'approver is required (a named human approver)' }
  if (body.note !== undefined && typeof body.note !== 'string') return { ok: false, error: 'note must be a string when present' }
  return { ok: true, value: { id: body.id, approved: body.approved, approver: body.approver, note: body.note } }
}
