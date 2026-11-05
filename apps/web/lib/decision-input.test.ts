import { describe, expect, it } from 'vitest'
import { parseDecisionInput } from './decision-input'

describe('parseDecisionInput', () => {
  it('accepts a valid decision', () => {
    const parsed = parseDecisionInput({ id: 'apr-0001', approved: true, approver: 'richard (ops)', note: 'ok' })
    expect(parsed).toEqual({ ok: true, value: { id: 'apr-0001', approved: true, approver: 'richard (ops)', note: 'ok' } })
  })
  it('rejects non-object bodies with the exact constraint', () => {
    expect(parseDecisionInput(null)).toMatchObject({ ok: false, error: 'body must be a JSON object' })
    expect(parseDecisionInput('approve')).toMatchObject({ ok: false, error: 'body must be a JSON object' })
    expect(parseDecisionInput([1])).toMatchObject({ ok: false, error: 'body must be a JSON object' })
  })
  it('rejects missing or blank required fields', () => {
    expect(parseDecisionInput({ approved: true, approver: 'r' })).toMatchObject({ ok: false, error: 'id is required' })
    expect(parseDecisionInput({ id: 'apr-0001', approved: 'yes', approver: 'r' })).toMatchObject({ ok: false, error: 'approved must be a boolean' })
    expect(parseDecisionInput({ id: 'apr-0001', approved: true })).toMatchObject({ ok: false, error: 'approver is required (a named human approver)' })
    expect(parseDecisionInput({ id: 'apr-0001', approved: true, approver: '   ' })).toMatchObject({ ok: false, error: 'approver is required (a named human approver)' })
  })
  it('rejects a non-string note', () => {
    expect(parseDecisionInput({ id: 'apr-0001', approved: true, approver: 'r', note: 7 })).toMatchObject({ ok: false, error: 'note must be a string when present' })
  })
})
