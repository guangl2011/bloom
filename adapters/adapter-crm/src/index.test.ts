/**
 * CRM-write adapter gate-enforcement tests (spec D3 P0): no recorded decision
 * → hard refusal for CRM writes; binding, single use, and workspace scoping
 * verified — zero network access in this suite.
 */

import { describe, expect, it } from 'vitest'
import { createApprovalGate } from '@bloom/svc-approval/gate'
import { createCrmAdapter, InMemoryCrmStore } from './index'
import type { CrmOpportunityRecord } from './index'

const WS = 'ws_test'

/** Seeds one opportunity in the mirror store for the write tests. */
function seededRecord(overrides: Partial<CrmOpportunityRecord> = {}): CrmOpportunityRecord {
  return {
    workspaceId: WS,
    opportunityId: 'opp_1',
    company: 'Display Factory Ltd',
    stage: 'qualified',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function wiredAdapter(record = seededRecord()) {
  const store = new InMemoryCrmStore()
  const gate = createApprovalGate()
  const adapter = createCrmAdapter({ store, gate })
  return { store, gate, adapter, record }
}

/** Submits + approves a crm_write request bound to the opportunity and stage. */
async function approvedDecision(
  gate: ReturnType<typeof createApprovalGate>,
  opportunityId: string,
  nextStage: string,
  workspaceId = WS,
): Promise<string> {
  const request = await gate.submit({
    workspaceId,
    action: 'crm_write',
    reason: `advance ${opportunityId} to ${nextStage}`,
    requestedBy: 'conversion',
    payload: { opportunityId, nextStage },
  })
  await gate.decide({ workspaceId, requestId: request.id, outcome: 'approve', approver: 'ops' })
  return request.id
}

describe('crm adapter — gate enforcement (P0)', () => {
  it('refuses a write with no gate record at all — hard refusal, nothing written', async () => {
    const { adapter, store, record } = wiredAdapter()
    await store.insert(record)
    const result = await adapter.writeOpportunity.execute(
      { opportunityId: record.opportunityId, nextStage: 'opportunity', approvalDecisionId: 'req_none' },
      { workspaceId: WS, runId: 'run_1' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/approval gate refused/)
    }
    expect(await store.get(WS, record.opportunityId)).toMatchObject({ stage: 'qualified', version: 1 })
  })

  it('refuses a write whose approval is pending or was denied', async () => {
    const { gate, adapter, store, record } = wiredAdapter()
    await store.insert(record)

    const pending = await gate.submit({
      workspaceId: WS,
      action: 'crm_write',
      reason: 'advance opp_1',
      requestedBy: 'conversion',
      payload: { opportunityId: 'opp_1', nextStage: 'opportunity' },
    })
    const pendingWrite = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'opportunity', approvalDecisionId: pending.id },
      { workspaceId: WS },
    )
    expect(pendingWrite.ok).toBe(false)

    await gate.decide({ workspaceId: WS, requestId: pending.id, outcome: 'deny', approver: 'ops' })
    const deniedWrite = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'opportunity', approvalDecisionId: pending.id },
      { workspaceId: WS },
    )
    expect(deniedWrite.ok).toBe(false)

    expect(await store.get(WS, 'opp_1')).toMatchObject({ stage: 'qualified', version: 1 })
  })

  it('writes exactly once with a valid approval — stage advanced, version bumped, approver from the gate', async () => {
    const { gate, adapter, store, record } = wiredAdapter()
    await store.insert(record)
    const decisionId = await approvedDecision(gate, 'opp_1', 'opportunity')

    const result = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'opportunity', approvalDecisionId: decisionId },
      { workspaceId: WS },
    )
    expect(result.ok).toBe(true)
    const data = result.ok ? (result.data as { approver: string; previousStage: string; stage: string }) : undefined
    expect(data).toMatchObject({ approver: 'ops', previousStage: 'qualified', stage: 'opportunity' })

    const written = await store.get(WS, 'opp_1')
    expect(written).toMatchObject({ stage: 'opportunity', version: 2 })

    // Single-use: replaying with the same decision is refused.
    const replay = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'negotiation', approvalDecisionId: decisionId },
      { workspaceId: WS },
    )
    expect(replay.ok).toBe(false)
    expect(await store.get(WS, 'opp_1')).toMatchObject({ stage: 'opportunity', version: 2 })
  })

  it('refuses when the write does not match the approved payload (binding)', async () => {
    const { gate, adapter, store, record } = wiredAdapter()
    await store.insert(record)
    const decisionId = await approvedDecision(gate, 'opp_1', 'opportunity')

    const swapped = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'won', approvalDecisionId: decisionId },
      { workspaceId: WS },
    )
    expect(swapped.ok).toBe(false)
    expect(await store.get(WS, 'opp_1')).toMatchObject({ stage: 'qualified', version: 1 })
  })

  it('refuses unknown stages and no-op transitions before asking the gate', async () => {
    const { adapter, store, record } = wiredAdapter()
    await store.insert(record)

    const unknownStage = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'slipped', approvalDecisionId: 'req_x' },
      { workspaceId: WS },
    )
    expect(unknownStage.ok).toBe(false)

    const noOp = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'qualified', approvalDecisionId: 'req_x' },
      { workspaceId: WS },
    )
    expect(noOp.ok).toBe(false)

    expect(await store.get(WS, 'opp_1')).toMatchObject({ stage: 'qualified', version: 1 })
  })

  it('is workspace-scoped: another workspace cannot see or write a foreign record', async () => {
    const { gate, adapter, store, record } = wiredAdapter()
    await store.insert(record)

    // A decision from another workspace cannot drive a write here.
    const foreignDecision = await approvedDecision(gate, 'opp_1', 'opportunity', 'ws_other')
    const foreignWrite = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'opportunity', approvalDecisionId: foreignDecision },
      { workspaceId: 'ws_other' },
    )
    expect(foreignWrite.ok).toBe(false)

    const decisionId = await approvedDecision(gate, 'opp_1', 'opportunity')
    const write = await adapter.writeOpportunity.execute(
      { opportunityId: 'opp_1', nextStage: 'opportunity', approvalDecisionId: decisionId },
      { workspaceId: WS },
    )
    expect(write.ok).toBe(true)
    expect(await store.get(WS, 'opp_1')).toMatchObject({ stage: 'opportunity', version: 2 })
    expect(record.workspaceId).toBe(WS)
  })
})
