/**
 * Dashboard data seam. Views render these models no matter where they come
 * from; today every source is the fetch-less fixture path because the agent
 * service (D3b) and approval gates (D3f) are not wired yet.
 *
 * The swap point when those land: replace the fixture reads with calls to the
 * workflow/approval/credits services and return source: 'service'. View
 * components and tests stay untouched — they depend only on the models.
 */
import type { DashboardData, DataSource, WorkflowRunView, ApprovalItemView } from './view-models'
import { SAMPLE_APPROVALS, SAMPLE_CREDITS, SAMPLE_LEADS, SAMPLE_RUNS } from './fixtures'

export interface DashboardSnapshot {
  data: DashboardData
  source: DataSource
}

/** Runs history — service-backed once D3b lands; fixture path today. */
export function loadWorkflowRuns(): { runs: WorkflowRunView[]; source: DataSource } {
  return { runs: SAMPLE_RUNS, source: 'sample' }
}

/**
 * Approval queue with locally-recorded decisions applied on top of the
 * fixtures. Once D3f lands, `applyDecisions` runs against the approval
 * service's queue instead of the in-memory store.
 */
export function loadApprovalQueue(
  decided: ReadonlyArray<{
    id: string
    approved: boolean
    approver: string
    decidedAt: string
    note?: string
  }>,
): {
  items: ApprovalItemView[]
  source: DataSource
} {
  return { items: applyDecisions(SAMPLE_APPROVALS, decided), source: 'sample' }
}

/**
 * The mock decision store has no queue state of its own — the gateway
 * validates the request id against the known queue before recording, so a
 * decision for an unknown gate request is a typed 404, never a silent accept.
 */
export function knownApprovalIds(): string[] {
  return SAMPLE_APPROVALS.map((item) => item.id)
}

/** Pure merge of recorded decisions onto queue items — unit-tested. */
export function applyDecisions(
  items: ApprovalItemView[],
  decided: ReadonlyArray<{
    id: string
    approved: boolean
    approver: string
    decidedAt: string
    note?: string
  }>,
): ApprovalItemView[] {
  const byId = new Map(decided.map((decision) => [decision.id, decision]))
  return items.map((item) => {
    const decision = byId.get(item.id)
    if (!decision) return item
    return {
      ...item,
      status: decision.approved ? 'approved' : 'rejected',
      decidedBy: decision.approver,
      decidedAt: decision.decidedAt,
      note: decision.note,
    }
  })
}

/** Credits view — the credits service owns the ledger; fixture until wired. */
export function loadCredits(): { credits: DashboardData['credits']; source: DataSource } {
  return { credits: SAMPLE_CREDITS, source: 'sample' }
}

/** Lead quality snapshot — internal_v1 scores with engine attribution. */
export function loadLeadQuality(): { leads: DashboardData['leads']; source: DataSource } {
  return { leads: SAMPLE_LEADS, source: 'sample' }
}
