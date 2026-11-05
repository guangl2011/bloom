/**
 * Email adapter gate-enforcement tests (spec D3 P0): no recorded decision →
 * hard refusal for email; approval binding, single use, and the stub-only
 * test posture are all verified here — zero network access in this suite.
 */

import { describe, expect, it } from 'vitest'
import { createApprovalGate } from '@bloom/svc-approval/gate'
import { createEmailAdapter, createStubEmailProvider, httpEmailProviderProblems } from './index'

const WS = 'ws_test'
const CTX = { workspaceId: WS, runId: 'run_1' }

/** Builds a real gate + stub-provider adapter wired the way production wires them. */
function wiredAdapter() {
  const gate = createApprovalGate()
  const provider = createStubEmailProvider()
  const adapter = createEmailAdapter({ gate, provider })
  return { gate, provider, adapter }
}

/** Drafts a message and returns the draft id. */
async function queueDraft(adapter: ReturnType<typeof createEmailAdapter>, to = 'a@example.com') {
  const result = await adapter.draft.execute(
    { to, subject: 'Hi', body: 'Hello from Bloom' },
    CTX,
  )
  if (!result.ok) throw new Error(`draft failed: ${result.error}`)
  return (result.data as { draftId: string }).draftId
}

describe('email adapter — gate enforcement (P0)', () => {
  it('refuses a send with no gate record at all — hard refusal, nothing sent', async () => {
    const { adapter, provider } = wiredAdapter()
    const draftId = await queueDraft(adapter)
    const result = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: 'req_none' },
      CTX,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/approval gate refused/)
    }
    expect(provider.sent).toHaveLength(0)
  })

  it('refuses a send whose approval is still pending', async () => {
    const { gate, adapter, provider } = wiredAdapter()
    const draftId = await queueDraft(adapter)
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    const result = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: record.id },
      CTX,
    )
    expect(result).toMatchObject({ ok: false })
    expect(provider.sent).toHaveLength(0)
  })

  it('refuses a send whose approval was denied', async () => {
    const { gate, adapter, provider } = wiredAdapter()
    const draftId = await queueDraft(adapter)
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'deny', approver: 'ops' })
    const result = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: record.id },
      CTX,
    )
    expect(result.ok).toBe(false)
    expect(provider.sent).toHaveLength(0)
  })

  it('sends exactly once with a valid approval — and the approver comes from the gate, not the caller', async () => {
    const { gate, adapter, provider } = wiredAdapter()
    const draftId = await queueDraft(adapter)
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({
      workspaceId: WS,
      requestId: record.id,
      outcome: 'approve',
      approver: 'ops@customer.com',
    })

    const result = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: record.id },
      CTX,
    )
    expect(result.ok).toBe(true)
    const data = result.ok ? (result.data as { approver: string; messageId: string }) : undefined
    expect(data?.approver).toBe('ops@customer.com')
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0]?.to).toBe('a@example.com')

    // The approval is single-use: a replayed send is refused.
    const replay = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: record.id },
      CTX,
    )
    expect(replay.ok).toBe(false)
    expect(provider.sent).toHaveLength(1)
  })

  it('refuses when the send does not match the approved payload (binding)', async () => {
    const { gate, adapter, provider } = wiredAdapter()
    const draftId = await queueDraft(adapter, 'a@example.com')
    const record = await gate.submit({
      workspaceId: WS,
      action: 'email_send',
      reason: 'send draft 1',
      requestedBy: 'outreach',
      payload: { to: 'a@example.com', subject: 'Hi' },
    })
    await gate.decide({ workspaceId: WS, requestId: record.id, outcome: 'approve', approver: 'ops' })

    const swapped = await adapter.send.execute(
      { to: 'victim@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId, approvalDecisionId: record.id },
      CTX,
    )
    expect(swapped.ok).toBe(false)
    expect(provider.sent).toHaveLength(0)
  })

  it('refuses a send referencing an unknown or mismatched draft', async () => {
    const { adapter, provider } = wiredAdapter()
    const unknownDraft = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello from Bloom', draftId: 'draft_404', approvalDecisionId: 'req_x' },
      CTX,
    )
    expect(unknownDraft.ok).toBe(false)
    expect(provider.sent).toHaveLength(0)

    const draftId = await queueDraft(adapter)
    const mismatched = await adapter.send.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'CHANGED BODY', draftId, approvalDecisionId: 'req_x' },
      CTX,
    )
    expect(mismatched.ok).toBe(false)
    expect(provider.sent).toHaveLength(0)
  })

  it('drafts queue without a gate record — they are the review artifact', async () => {
    const { adapter } = wiredAdapter()
    const draftId = await queueDraft(adapter)
    expect(adapter.outbox.all()).toHaveLength(1)
    expect(draftId).toMatch(/^draft-/)
  })
})

describe('email adapter — zero-send guarantee', () => {
  it('the real relay provider cannot be constructed in a test-mode environment', () => {
    const testEnv = { BLOOM_ENV: 'test', BLOOM_ALLOW_REAL_SENDS: '1', EMAIL_RELAY_URL: 'https://relay', EMAIL_RELAY_TOKEN: 't' }
    expect(httpEmailProviderProblems(testEnv).some((problem) => problem.includes('test-mode'))).toBe(true)
  })

  it('the stub provider is the test provider — no network surface', () => {
    const provider = createStubEmailProvider()
    expect(provider.id).toBe('stub')
    expect(provider.sent).toHaveLength(0)
  })
})
