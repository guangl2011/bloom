/**
 * P0 gate-enforcement tests (spec D3): no recorded decision → hard refusal;
 * denial and expiry are first-class outcomes; every gate decision and every
 * authorize attempt is in the audit trail with its workspace_id.
 */

import { describe, expect, it } from 'vitest'
import { createApprovalGate } from './gate'
import { InMemoryApprovalStore } from './store'
import { ApprovalGateError } from './types'

const WS = 'ws_test'

/** Fixed clock the tests advance manually. */
function testClock() {
  let current = Date.parse('2026-01-01T00:00:00.000Z')
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms
    },
  }
}

function gateWith(clock: ReturnType<typeof testClock>) {
  return createApprovalGate({
    now: clock.now,
    store: new InMemoryApprovalStore(),
    requestTtlMs: 24 * 60 * 60 * 1000,
    approvalValidityMs: 60 * 60 * 1000,
  })
}

describe('approval gate — enforcement', () => {
  it('refuses authorize for an unknown decision id (no record → hard refusal)', async () => {
    const gate = gateWith(testClock())
    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: 'req_does_not_exist',
      action: 'email_send',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not_found')
    }
  })

  it('refuses authorize while the request is still pending', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
    })
    expect(result).toMatchObject({ ok: false, reason: 'pending' })
  })

  it('runs the full happy path: submit → approve → authorize once → consumed', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })

    const pending = await gate.asApprovalInterface(WS).request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(pending.approved).toBe(false)
    expect(pending.decisionId).toBe(record.id)

    const decision = await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'approve',
      approver: 'ops@customer.com',
    })
    expect(decision.outcome).toBe('approved')
    expect(decision.validUntil).toBeDefined()

    const allowed = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(allowed).toMatchObject({ ok: true, approver: 'ops@customer.com' })

    const replay = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(replay).toMatchObject({ ok: false, reason: 'already_used' })
  })

  it('binds executions to the approved payload identity fields', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })

    const swappedRecipient = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'victim@example.com', subject: 'Hi' },
    })
    expect(swappedRecipient).toMatchObject({ ok: false, reason: 'binding_mismatch' })

    const unapprovedKey = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', body: 'inject' },
    })
    expect(unapprovedKey).toMatchObject({ ok: false, reason: 'binding_mismatch' })
  })

  it('refuses authorize when the action does not match the approved request', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })
    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'crm_write',
    })
    expect(result).toMatchObject({ ok: false, reason: 'action_mismatch' })
  })

  it('never leaks a request across workspaces — a foreign id is not_found', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'crm_write',
      reason: 'advance OPP-1',
      requestedBy: 'conversion',
      payload: { opportunityId: 'OPP-1' },
    })
    await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'approve',
      approver: 'ops',
    })
    const result = await gate.authorize({
      workspaceId: 'ws_other',
      decisionId: record.id,
      action: 'crm_write',
    })
    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
  })
})

describe('approval gate — denial and expiry are first-class', () => {
  it('a denied request refuses execution with reason denied', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    const decision = await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'deny',
      approver: 'ops',
      note: 'bad fit',
    })
    expect(decision.outcome).toBe('denied')

    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'denied' })

    const compat = await gate.asApprovalInterface(WS).request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(compat).toMatchObject({ approved: false, note: 'denied' })
  })

  it('a re-request of a denied payload returns the denial instead of re-asking the human', async () => {
    const gate = gateWith(testClock())
    const approvals = gate.asApprovalInterface(WS)
    const payload = { to: 'a@example.com', subject: 'Hi' }
    await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })
    const pending = await gate.listPending(WS)
    await gate.decide({ workspaceId: WS, requestId: pending[0]!.id, outcome: 'deny', approver: 'ops' })

    const revisit = await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })
    expect(revisit).toMatchObject({ approved: false, note: 'denied' })
    expect((await gate.listPending(WS)).length).toBe(0)
  })

  it('a re-request after expiry opens a fresh cycle with a new deadline', async () => {
    const clock = testClock()
    const gate = gateWith(clock)
    const approvals = gate.asApprovalInterface(WS)
    const payload = { to: 'a@example.com', subject: 'Hi' }
    const first = await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })

    clock.advance(24 * 60 * 60 * 1000 + 1)
    await gate.sweepExpired()
    const second = await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })
    expect(second.decisionId).not.toBe(first.decisionId)
    expect(second).toMatchObject({ approved: false, note: 'pending human decision' })
  })

  it('a pending request past its TTL expires — approving it is refused and authorize reports expired', async () => {
    const clock = testClock()
    const gate = gateWith(clock)
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })

    clock.advance(24 * 60 * 60 * 1000 + 1)
    const swept = await gate.sweepExpired()
    expect(swept).toBe(1)

    const lateDecision = await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'approve',
      approver: 'ops',
    })
    expect(lateDecision.outcome).toBe('rejected')

    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('an approved token past its validity window refuses execution as expired', async () => {
    const clock = testClock()
    const gate = gateWith(clock)
    const record = await gate.submit({
      workspaceId: WS,
      action: 'crm_write',
      reason: 'advance OPP-1',
      requestedBy: 'conversion',
      payload: { opportunityId: 'OPP-1' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })

    clock.advance(60 * 60 * 1000 + 1)
    const result = await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'crm_write',
      binding: { opportunityId: 'OPP-1' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('refuses a decision attempt on an already-approved request (records the rejection)', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })
    const second = await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'approve',
      approver: 'ops2',
    })
    expect(second.outcome).toBe('rejected')
  })

  it('throws for a decision on an unknown request', async () => {
    const gate = gateWith(testClock())
    await expect(
      gate.decide({ workspaceId: WS, requestId: 'req_nope', outcome: 'approve', approver: 'ops' }),
    ).rejects.toMatchObject({ code: 'request_not_found' } satisfies { code: ApprovalGateError['code'] })
    await expect(
      gate.decide({ workspaceId: WS, requestId: 'req_nope', outcome: 'approve', approver: '' }),
    ).rejects.toBeInstanceOf(ApprovalGateError)
  })
})

describe('approval gate — idempotent re-request and audit completeness', () => {
  it('re-requests of the same payload reuse the pending record instead of stacking duplicates', async () => {
    const gate = gateWith(testClock())
    const approvals = gate.asApprovalInterface(WS)
    const payload = { to: 'a@example.com', subject: 'Hi' }
    const first = await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })
    const second = await approvals.request({
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload,
    })
    expect(second.decisionId).toBe(first.decisionId)

    const events = (await gate.listAudit(WS)).map((entry) => entry.event)
    expect(events.filter((event) => event === 'gate.requested')).toHaveLength(1)
    expect(events.filter((event) => event === 'gate.revisit')).toHaveLength(1)

    // A different payload is a different action — new record.
    const third = await approvals.request({
      action: 'email_send',
      reason: 'send draft 2',
      requestedBy: 'outreach',
      payload: { to: 'b@example.com', subject: 'Hi' },
    })
    expect(third.decisionId).not.toBe(first.decisionId)
  })

  it('records every lifecycle step in the audit trail with workspace_id', async () => {
    const gate = gateWith(testClock())
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.authorize({ workspaceId: WS, decisionId: record.id, action: 'email_send' })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })
    await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.authorize({
      workspaceId: WS,
      decisionId: record.id,
      action: 'email_send',
      binding: { to: 'a@example.com', subject: 'Hi' },
    })

    const trail = await gate.listAudit(WS)
    const events = trail.map((entry) => entry.event)
    expect(events).toEqual([
      'gate.requested',
      'gate.authorize.refused',
      'gate.decision',
      'gate.authorize.allowed',
      'gate.authorize.refused',
    ])

    // Every entry carries the workspace id and names its subject.
    for (const entry of trail) {
      expect(entry.workspaceId).toBe(WS)
      expect(entry.at).not.toBe('')
    }
    const refused = trail.filter((entry) => entry.event === 'gate.authorize.refused')
    expect(refused.map((entry) => entry.detail.reason)).toEqual(['pending', 'already_used'])

    // The other workspace's trail is empty — no cross-workspace leakage.
    expect(await gate.listAudit('ws_other')).toEqual([])
  })
})
