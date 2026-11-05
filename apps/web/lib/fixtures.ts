/**
 * Deterministic fixture data for the reference deployment (Display Factory
 * Wholesale, Lead Generation Pro). These are the fetch-less mock data paths
 * the spec calls for while the agent service (D3b) and approval gates (D3f)
 * are still being wired — the dashboard renders identically against compose
 * Postgres with zero external sends.
 *
 * Fixture contents mirror the reference deployment contract: 50-lead monthly
 * quota, A/B/C scoring from internal_v1, obvious-primary/deepline-fallback
 * scan engines, and the hard gate actions.
 */
import type { ApprovalItemView, CreditsView, LeadQualityView, TransactionView, WorkflowRunView } from './view-models'
import { aTierAccuracy, usageBreakdown } from './view-models'

export const REFERENCE_WORKSPACE_ID = 'display-factory-wholesale'

export const SAMPLE_RUNS: WorkflowRunView[] = [
  {
    id: 'run-2026-11-02-001',
    workspaceId: REFERENCE_WORKSPACE_ID,
    workflowId: 'purchase_signals',
    agentId: 'revenue-intelligence',
    trigger: 'schedule',
    status: 'success',
    startedAt: '2026-11-02T06:00:04Z',
    durationMs: 214_000,
    retries: 0,
    auditEvents: [
      { id: 'aud-1001', kind: 'workflow_started', at: '2026-11-02T06:00:04Z', detail: 'weekly purchase-signal scan' },
      { id: 'aud-1002', kind: 'step_completed', at: '2026-11-02T06:01:40Z', detail: 'scan (engine: obvious)' },
      { id: 'aud-1003', kind: 'step_completed', at: '2026-11-02T06:03:18Z', detail: 'score (internal_v1)' },
      { id: 'aud-1004', kind: 'run_finished', at: '2026-11-02T06:03:38Z', detail: '42 signals → lead pool' },
    ],
  },
  {
    id: 'run-2026-11-03-002',
    workspaceId: REFERENCE_WORKSPACE_ID,
    workflowId: 'lead_discovery',
    agentId: 'lead',
    trigger: 'schedule',
    status: 'retrying',
    startedAt: '2026-11-03T06:00:02Z',
    durationMs: null,
    retries: 1,
    auditEvents: [
      { id: 'aud-1010', kind: 'workflow_started', at: '2026-11-03T06:00:02Z', detail: 'lead discovery to quota' },
      { id: 'aud-1011', kind: 'step_completed', at: '2026-11-03T06:02:11Z', detail: 'discover (engine: obvious)' },
      { id: 'aud-1012', kind: 'gate_raised', at: '2026-11-03T06:02:30Z', detail: 'bulk_scan — retry 1' },
    ],
  },
  {
    id: 'run-2026-11-01-003',
    workspaceId: REFERENCE_WORKSPACE_ID,
    workflowId: 'outreach_sequence',
    agentId: 'outreach',
    trigger: 'schedule',
    status: 'success',
    startedAt: '2026-11-01T08:00:00Z',
    durationMs: 96_500,
    retries: 0,
    auditEvents: [
      { id: 'aud-1020', kind: 'workflow_started', at: '2026-11-01T08:00:00Z', detail: 'email sequence drafting' },
      { id: 'aud-1021', kind: 'gate_raised', at: '2026-11-01T08:01:12Z', detail: 'email_send — queued for approval' },
      { id: 'aud-1022', kind: 'run_finished', at: '2026-11-01T08:01:36Z', detail: '3 drafts queued, nothing sent' },
    ],
  },
  {
    id: 'run-2026-10-28-004',
    workspaceId: REFERENCE_WORKSPACE_ID,
    workflowId: 'market_intel',
    agentId: 'revenue-intelligence',
    trigger: 'schedule',
    status: 'failed',
    startedAt: '2026-10-28T06:00:03Z',
    durationMs: 41_200,
    retries: 2,
    auditEvents: [
      { id: 'aud-1030', kind: 'workflow_started', at: '2026-10-28T06:00:03Z', detail: 'monthly brief' },
      { id: 'aud-1031', kind: 'step_completed', at: '2026-10-28T06:00:21Z', detail: 'scan (engine: obvious) — failed, fallback attempted' },
      { id: 'aud-1032', kind: 'step_completed', at: '2026-10-28T06:00:39Z', detail: 'scan (engine: deepline) — failed' },
      { id: 'aud-1033', kind: 'run_finished', at: '2026-10-28T06:00:44Z', detail: 'both scan engines failed' },
    ],
  },
  {
    id: 'run-2026-10-31-005',
    workspaceId: REFERENCE_WORKSPACE_ID,
    workflowId: 'market_intel',
    agentId: 'revenue-intelligence',
    trigger: 'manual',
    status: 'success',
    startedAt: '2026-10-31T09:15:00Z',
    durationMs: 723_000,
    retries: 0,
    auditEvents: [
      { id: 'aud-1040', kind: 'workflow_started', at: '2026-10-31T09:15:00Z', detail: 'monthly brief (manual rerun)' },
      { id: 'aud-1041', kind: 'step_completed', at: '2026-10-31T09:24:30Z', detail: 'market map rebuilt' },
      { id: 'aud-1042', kind: 'run_finished', at: '2026-10-31T09:27:03Z', detail: 'brief rendered' },
    ],
  },
]

export const SAMPLE_APPROVALS: ApprovalItemView[] = [
  {
    id: 'apr-0001',
    workspaceId: REFERENCE_WORKSPACE_ID,
    action: 'email_send',
    reason: 'Outreach sequence draft for 3 contacts at Acme Industrial GmbH (first-touch + 2 follow-ups)',
    requestedBy: 'outreach',
    requestedAt: '2026-11-01T08:01:12Z',
    payloadSummary: '3 emails · sequence "intro-en-v2" · scheduled send after approval',
    runId: 'run-2026-11-01-003',
    status: 'pending',
  },
  {
    id: 'apr-0002',
    workspaceId: REFERENCE_WORKSPACE_ID,
    action: 'crm_write',
    reason: 'Advance opportunity "Müller Hydraulics — vacuum forming lines" from Qualified to Proposal',
    requestedBy: 'conversion',
    requestedAt: '2026-11-02T14:22:45Z',
    payloadSummary: '1 CRM record update · opportunity OPP-2211',
    status: 'pending',
  },
  {
    id: 'apr-0000',
    workspaceId: REFERENCE_WORKSPACE_ID,
    action: 'bulk_scan',
    reason: 'Weekly purchase-signal scan expansion to 2 additional regions (SE, DK)',
    requestedBy: 'revenue-intelligence',
    requestedAt: '2026-10-30T10:05:00Z',
    payloadSummary: 'scan scope +2 regions · max 50 signals/period',
    runId: 'run-2026-10-28-004',
    status: 'approved',
    decidedBy: 'richard (ops)',
    decidedAt: '2026-10-30T11:00:00Z',
    note: 'Approved for November; review at next brief.',
  },
]

const SAMPLE_USAGE_RECORDS: Array<{ tool: string; model: string; units: number; costCredits: number }> = [
  { tool: 'llm', model: 'claude-sonnet', units: 640, costCredits: 96.4 },
  { tool: 'llm', model: 'claude-sonnet', units: 410, costCredits: 61.8 },
  { tool: 'llm', model: 'claude-haiku', units: 890, costCredits: 26.7 },
  { tool: 'scan-engine', model: 'obvious-research', units: 4, costCredits: 40.0 },
  { tool: 'scan-engine', model: 'obvious-research', units: 8, costCredits: 80.0 },
  { tool: 'enrichment', model: 'apollo', units: 50, costCredits: 25.0 },
]

const SAMPLE_TRANSACTIONS: TransactionView[] = [
  { id: 'ctx-3001', kind: 'usage', deltaCredits: -80.0, note: 'weekly purchase-signal scan', createdAt: '2026-11-02T06:03:40Z' },
  { id: 'ctx-3002', kind: 'usage', deltaCredits: -61.8, note: 'email sequence drafting', createdAt: '2026-11-01T08:01:30Z' },
  { id: 'ctx-3003', kind: 'usage', deltaCredits: -25.0, note: 'lead enrichment batch', createdAt: '2026-10-31T16:12:00Z' },
  { id: 'ctx-3004', kind: 'topup', deltaCredits: 500.0, note: 'November opening top-up', createdAt: '2026-10-31T00:00:05Z' },
]

export const SAMPLE_CREDITS: CreditsView = {
  workspaceId: REFERENCE_WORKSPACE_ID,
  balanceCredits: 318.26,
  periodLabel: 'November 2026',
  breakdown: usageBreakdown(SAMPLE_USAGE_RECORDS),
  transactions: SAMPLE_TRANSACTIONS,
}

export const SAMPLE_LEADS: LeadQualityView = {
  workspaceId: REFERENCE_WORKSPACE_ID,
  scoringModel: 'internal_v1',
  poolSize: 42,
  monthlyQuota: 50,
  tierCounts: { A: 9, B: 19, C: 14 },
  aTierAccuracy: aTierAccuracy({ aTierChecked: 9, aTierCorrect: 8 }),
  aTierAccuracyTarget: 0.85,
  engineAttribution: [
    { engine: 'obvious', signals: 38, leads: 38 },
    { engine: 'deepline', signals: 6, leads: 4 },
  ],
  scoredAt: '2026-11-03T06:05:00Z',
}
