/**
 * Ops dashboard view models — the typed shape the UI renders, independent of
 * where the data comes from (fixture path today, service adapters later).
 *
 * The dashboard is internal-only (Bloom team operating a single-tenant v1.0
 * deployment); workspace_id still travels on every model so the v2.0
 * multi-tenant upgrade keeps the same query discipline (spec locked decision 11).
 */
import type { GateAction } from '@bloom/interfaces'

export type DataSource = 'sample' | 'service'

export type WorkflowRunStatus = 'success' | 'failed' | 'running' | 'retrying'

export type WorkflowTrigger = 'schedule' | 'webhook' | 'manual'

/** Audit-trail reference — a run is traceable through the records it left. */
export interface AuditEventRef {
  id: string
  kind: 'workflow_started' | 'step_completed' | 'gate_raised' | 'decision_recorded' | 'run_finished'
  at: string
  detail?: string
}

export interface WorkflowRunView {
  id: string
  workspaceId: string
  workflowId: string
  agentId: string
  trigger: WorkflowTrigger
  status: WorkflowRunStatus
  startedAt: string
  /** null while the run is still in flight. */
  durationMs: number | null
  retries: number
  auditEvents: AuditEventRef[]
}

export type ApprovalItemStatus = 'pending' | 'approved' | 'rejected'

export interface ApprovalItemView {
  id: string
  workspaceId: string
  action: GateAction
  reason: string
  /** Agent that raised the gate. */
  requestedBy: string
  requestedAt: string
  payloadSummary: string
  runId?: string
  status: ApprovalItemStatus
  decidedBy?: string
  decidedAt?: string
  note?: string
}

export interface UsageBreakdownRow {
  tool: string
  model: string
  calls: number
  units: number
  costCredits: number
}

export interface TransactionView {
  id: string
  kind: 'usage' | 'topup' | 'adjustment'
  deltaCredits: number
  note?: string
  createdAt: string
}

export interface CreditsView {
  workspaceId: string
  balanceCredits: number
  periodLabel: string
  breakdown: UsageBreakdownRow[]
  transactions: TransactionView[]
}

/** `internal_v1` scoring output per spec decision 4 — tuned per customer. */
export interface EngineAttribution {
  engine: 'obvious' | 'deepline'
  signals: number
  leads: number
}

export interface LeadQualityView {
  workspaceId: string
  scoringModel: 'internal_v1'
  poolSize: number
  monthlyQuota: number
  tierCounts: { A: number; B: number; C: number }
  /** Share of sampled A-tier leads confirmed correct by the weekly quality check. */
  aTierAccuracy: number | null
  aTierAccuracyTarget: number
  engineAttribution: EngineAttribution[]
  scoredAt: string
}

export interface DashboardData {
  runs: WorkflowRunView[]
  approvals: ApprovalItemView[]
  credits: CreditsView
  leads: LeadQualityView
  source: DataSource
}

const CREDIT_DISPLAY_DIGITS = 2

/** Formats a fractional credit balance for display, e.g. 318.26. */
export function formatCredits(value: number): string {
  return value.toFixed(CREDIT_DISPLAY_DIGITS)
}

/** UTC-only timestamp rendering — deterministic across server/client timezones. */
export function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`
}

/**
 * Groups priced usage records into a per-tool/per-model breakdown, sorted by
 * cost descending — the credits view's usage table. Pure; unit-tested.
 */
export function usageBreakdown(
  records: ReadonlyArray<{ tool: string; model: string; units: number; costCredits: number }>,
): UsageBreakdownRow[] {
  const byKey = new Map<string, UsageBreakdownRow>()
  for (const record of records) {
    const key = `${record.tool}:${record.model}`
    const existing = byKey.get(key)
    if (existing) {
      existing.calls += 1
      existing.units += record.units
      existing.costCredits += record.costCredits
    } else {
      byKey.set(key, { tool: record.tool, model: record.model, calls: 1, units: record.units, costCredits: record.costCredits })
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.costCredits - a.costCredits || a.tool.localeCompare(b.tool) || a.model.localeCompare(b.model),
  )
}

/** A-tier accuracy share; null when nothing was checked (never render 0% for "no data"). */
export function aTierAccuracy(input: { aTierChecked: number; aTierCorrect: number }): number | null {
  if (input.aTierChecked <= 0) return null
  return input.aTierCorrect / input.aTierChecked
}
