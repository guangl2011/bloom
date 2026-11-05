import { afterEach, describe, expect, it, vi } from 'vitest'
import { listDecisions, resetDecisions } from './decision-store'
import { decideApproval } from './approval-gateway'
import { applyDecisions, loadApprovalQueue, loadCredits, loadLeadQuality, loadWorkflowRuns } from './data'

afterEach(() => {
  resetDecisions()
  vi.unstubAllEnvs()
})

describe('load* seams', () => {
  it('serves the fixture path with sample source while services are unwired', () => {
    expect(loadWorkflowRuns().source).toBe('sample')
    expect(loadCredits().source).toBe('sample')
    expect(loadLeadQuality().source).toBe('sample')
    expect(loadApprovalQueue([]).source).toBe('sample')
  })
  it('exposes the reference deployment contract in the fixtures', () => {
    const { leads } = loadLeadQuality()
    expect(leads.monthlyQuota).toBe(50)
    expect(leads.scoringModel).toBe('internal_v1')
    expect(leads.engineAttribution.map((row) => row.engine)).toEqual(['obvious', 'deepline'])
    const { runs } = loadWorkflowRuns()
    expect(runs.every((run) => run.workspaceId.length > 0)).toBe(true)
  })
})

describe('applyDecisions', () => {
  it('overrides status and approver for decided items only', () => {
    const queue = loadApprovalQueue([]).items
    const target = queue.find((item) => item.status === 'pending')
    if (!target) throw new Error('fixture queue must contain a pending item')
    const decided = applyDecisions(queue, [
      { id: target.id, approved: true, approver: 'richard (ops)', decidedAt: '2026-11-05T10:00:00Z', note: 'go' },
    ])
    expect(decided.find((item) => item.id === target.id)).toMatchObject({ status: 'approved', decidedBy: 'richard (ops)', note: 'go' })
    expect(decided.filter((item) => item.id !== target.id)).toEqual(queue.filter((item) => item.id !== target.id))
  })
  it('leaves the queue untouched with no decisions', () => {
    const queue = loadApprovalQueue([]).items
    expect(applyDecisions(queue, [])).toEqual(queue)
  })
})

describe('approval queue end to end (mock path)', () => {
  it('a decision recorded through the gateway shows in the next queue load', async () => {
    const target = loadApprovalQueue([]).items.find((item) => item.status === 'pending')
    if (!target) throw new Error('fixture queue must contain a pending item')

    const outcome = await decideApproval({ id: target.id, approved: true, approver: 'richard (ops)' }, {})
    expect(outcome.via).toBe('local-mock')
    expect(outcome.approved).toBe(true)

    // The approvals page reloads the queue with exactly these records.
    const reloaded = loadApprovalQueue(listDecisions()).items
    expect(reloaded.find((item) => item.id === target.id)?.status).toBe('approved')
  })
  it('rejects a second decision for the same request', async () => {
    const target = loadApprovalQueue([]).items.find((item) => item.status === 'pending')
    if (!target) throw new Error('fixture queue must contain a pending item')
    await decideApproval({ id: target.id, approved: true, approver: 'richard (ops)' }, {})
    await expect(decideApproval({ id: target.id, approved: false, approver: 'richard (ops)' }, {})).rejects.toThrow(
      'approval already decided',
    )
  })
})
