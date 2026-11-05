/**
 * Zero-send guarantee — e2e guard (spec D3, P0). Three layers asserted here:
 *
 * 1. A test-mode environment with real-provider credentials refuses the real
 *    email provider at construction — config alone can never bridge the gap.
 * 2. The full gated pipeline (email draft → approval → send; CRM write →
 *    approval → write) runs with `fetch` rigged to throw, so any network
 *    attempt anywhere in the flow fails this suite — zero external sends.
 * 3. Every gate decision in the run — requests, refusals, the allowance,
 *    decisions — lands in the audit trail carrying the workspace id.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApprovalGate } from '@bloom/svc-approval/gate'
import {
  createEmailAdapter,
  createHttpEmailProvider,
  createStubEmailProvider,
  httpEmailProviderProblems,
} from '@bloom/adapter-email'
import { createCrmAdapter, InMemoryCrmStore } from '@bloom/adapter-crm'

afterEach(() => {
  vi.restoreAllMocks()
})

const TEST_ENV_WITH_REAL_CREDS = {
  BLOOM_ENV: 'test',
  BLOOM_ALLOW_REAL_SENDS: '1',
  EMAIL_RELAY_URL: 'https://relay.example.com/send',
  EMAIL_RELAY_TOKEN: 'real-token',
}
const OPS_ENV_WITHOUT_FLAG = {
  BLOOM_ENV: 'production',
  BLOOM_ALLOW_REAL_SENDS: '',
  EMAIL_RELAY_URL: 'https://relay.example.com/send',
  EMAIL_RELAY_TOKEN: 'real-token',
}
const OPS_ENV_OPERATIONAL = {
  BLOOM_ENV: 'production',
  BLOOM_ALLOW_REAL_SENDS: '1',
  EMAIL_RELAY_URL: 'https://relay.example.com/send',
  EMAIL_RELAY_TOKEN: 'real-token',
}

describe('zero-send guarantee — startup guard matrix', () => {
  it('a test-mode environment with real credentials refuses the real provider outright', () => {
    const problems = httpEmailProviderProblems(TEST_ENV_WITH_REAL_CREDS)
    expect(problems.some((problem) => problem.includes('test-mode'))).toBe(true)
    expect(() => createHttpEmailProvider(TEST_ENV_WITH_REAL_CREDS)).toThrow(/zero-send guarantee/)
  })

  it('operational mode still requires the explicit allow flag AND relay credentials', () => {
    const noFlag = httpEmailProviderProblems(OPS_ENV_WITHOUT_FLAG)
    expect(noFlag.some((problem) => problem.includes('BLOOM_ALLOW_REAL_SENDS'))).toBe(true)

    const noCreds = httpEmailProviderProblems({ BLOOM_ENV: 'production', BLOOM_ALLOW_REAL_SENDS: '1' })
    expect(noCreds.join('\n')).toMatch(/EMAIL_RELAY_URL/)
    expect(noCreds.join('\n')).toMatch(/EMAIL_RELAY_TOKEN/)
  })

  it('operational mode + explicit flag + credentials is the only constructible posture', () => {
    expect(httpEmailProviderProblems(OPS_ENV_OPERATIONAL)).toEqual([])
  })
})

describe('zero-send guarantee — e2e pipeline with the network disabled', () => {
  it('runs draft → approval → send and CRM write with fetch forbidden; refusals leave zero sends', async () => {
    // Any network attempt anywhere in the pipeline throws — suite fails on a real call.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('NETWORK CALL ATTEMPTED IN TEST — zero-send guarantee violated')
    })

    const gate = createApprovalGate()
    const provider = createStubEmailProvider()
    const email = createEmailAdapter({ gate, provider })
    const store = new InMemoryCrmStore()
    const crm = createCrmAdapter({ store, gate })
    const ctx = { workspaceId: 'ws_e2e', runId: 'run_e2e' }

    await store.insert({
      workspaceId: 'ws_e2e',
      opportunityId: 'opp_e2e',
      company: 'Display Factory Ltd',
      stage: 'qualified',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
    })

    // 1. Draft — queues for human review, not a gate action.
    const draft = await email.draft.execute(
      { to: 'buyer@example.com', subject: 'Quote follow-up', body: 'Hello from Bloom' },
      ctx,
    )
    expect(draft.ok).toBe(true)
    const draftId = draft.ok ? (draft.data as { draftId: string }).draftId : ''

    // 2. Send with no gate record — refused, nothing sent.
    const refused = await email.send.execute(
      { to: 'buyer@example.com', subject: 'Quote follow-up', body: 'Hello from Bloom', draftId, approvalDecisionId: 'req_none' },
      ctx,
    )
    expect(refused.ok).toBe(false)
    expect(provider.sent).toHaveLength(0)

    // 3. Human approves — bound to recipient and subject — then exactly one send.
    const emailReq = await gate.submit({
      workspaceId: 'ws_e2e',
      action: 'email_send',
      reason: 'send quote follow-up',
      requestedBy: 'outreach',
      payload: { to: 'buyer@example.com', subject: 'Quote follow-up' },
    })
    await gate.decide({ workspaceId: 'ws_e2e', requestId: emailReq.id, outcome: 'approve', approver: 'ops@customer.com' })
    const sent = await email.send.execute(
      { to: 'buyer@example.com', subject: 'Quote follow-up', body: 'Hello from Bloom', draftId, approvalDecisionId: emailReq.id },
      ctx,
    )
    expect(sent.ok).toBe(true)
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0]).toMatchObject({ to: 'buyer@example.com', subject: 'Quote follow-up' })

    // 4. CRM write with no gate record — refused; with approval — exactly one write.
    const crmRefused = await crm.writeOpportunity.execute(
      { opportunityId: 'opp_e2e', nextStage: 'opportunity', approvalDecisionId: 'req_none' },
      ctx,
    )
    expect(crmRefused.ok).toBe(false)
    expect(await store.get('ws_e2e', 'opp_e2e')).toMatchObject({ stage: 'qualified', version: 1 })

    const crmReq = await gate.submit({
      workspaceId: 'ws_e2e',
      action: 'crm_write',
      reason: 'advance opp_e2e to opportunity',
      requestedBy: 'conversion',
      payload: { opportunityId: 'opp_e2e', nextStage: 'opportunity' },
    })
    await gate.decide({ workspaceId: 'ws_e2e', requestId: crmReq.id, outcome: 'approve', approver: 'ops@customer.com' })
    const written = await crm.writeOpportunity.execute(
      { opportunityId: 'opp_e2e', nextStage: 'opportunity', approvalDecisionId: crmReq.id },
      ctx,
    )
    expect(written.ok).toBe(true)
    expect(await store.get('ws_e2e', 'opp_e2e')).toMatchObject({ stage: 'opportunity', version: 2 })

    // 5. Audit completeness: every step of both cycles is on the trail with the workspace id.
    const audit = await gate.listAudit('ws_e2e')
    const events = audit.map((entry) => entry.event)
    expect(events).toContain('gate.requested')
    expect(events).toContain('gate.decision')
    expect(events).toContain('gate.authorize.refused')
    expect(events).toContain('gate.authorize.allowed')
    expect(audit.every((entry) => entry.workspaceId === 'ws_e2e')).toBe(true)

    // The send summary: one email, one CRM write, zero network calls.
    expect(provider.sent).toHaveLength(1)
  })
})
