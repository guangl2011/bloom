/**
 * Live Postgres readers for the ops dashboard — the swap point `data.ts`
 * documents ("replace the fixture reads with calls to the services and
 * return source: 'service'"). A single-tenant v1.0 deployment points
 * DATABASE_URL at its own database; the dashboard then renders the real
 * workflow runs, approval-gate state, and credit ledger instead of samples.
 * Views depend only on the models, so components and their tests stay
 * untouched.
 *
 * Read-only by design: the only write this module exposes is the approval
 * decision itself (decideInPostgres), which goes through the same audited
 * gate the agents use — never around it.
 */

import type { Pool } from 'pg'
import type { SqlExecutor } from '@bloom/db'
import { createPgExecutorFromUrl } from '@bloom/db'
import { createApprovalGate } from '@bloom/svc-approval/gate'
import { PgApprovalStore } from '@bloom/svc-approval/store-pg'
import type { GateRequestRecord } from '@bloom/svc-approval/gate'
import type {
  ApprovalItemView,
  AuditEventRef,
  CreditsView,
  DataSource,
  WorkflowRunView,
  WorkflowRunStatus,
  WorkflowTrigger,
} from './view-models'
import { AlreadyDecidedError, UnknownApprovalError, type DecisionRecord } from './decision-store'
import type { DecisionInput } from './decision-input'

export type DecisionOutcome = DecisionRecord & { via: 'postgres' }

interface PoolCache {
  __bloomDashboardExecutor?: SqlExecutor
  __bloomDashboardPool?: Pool
}

const cache = globalThis as unknown as PoolCache

/** One executor per process (dev HMR safe) — reads only, small pool. */
function executor(): SqlExecutor {
  if (!cache.__bloomDashboardExecutor) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('DATABASE_URL is not set — the live dashboard path requires the deployment database')
    }
    const { exec, pool } = createPgExecutorFromUrl(url)
    cache.__bloomDashboardExecutor = exec
    cache.__bloomDashboardPool = pool
  }
  return cache.__bloomDashboardExecutor
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Workspace scope for this deployment. v1.0 is single-tenant: pin with
 * DASHBOARD_WORKSPACE, otherwise show the most recent workspace that has
 * runs (so the dashboard follows the latest reference cycle). A freshly
 * deployed, migrated-but-empty database is a legitimate state — the callers
 * render honest empty views, so this returns null instead of throwing.
 */
async function workspaceScope(exec: SqlExecutor): Promise<string | null> {
  const pinned = process.env.DASHBOARD_WORKSPACE
  if (pinned) return pinned
  const result = await exec(
    `SELECT workspace_id FROM workflow_runs WHERE deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  )
  const row = result.rows[0] as { workspace_id: string } | undefined
  return row?.workspace_id ?? null
}

// ── Runs ────────────────────────────────────────────────────────────────────

interface StepRow {
  readonly stepId: string
  readonly agentId: string
  readonly status: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly error?: string
}

interface RunRow {
  readonly run_id: string
  readonly workflow_id: string
  readonly workspace_id: string
  readonly trigger_payload: { readonly kind?: string }
  readonly attempt: number
  readonly status: string
  readonly started_at: Date
  readonly finished_at: Date | null
  readonly steps: StepRow[]
}

function runStatus(status: string, attempt: number): WorkflowRunStatus {
  if (status === 'succeeded') return 'success'
  if (status === 'running') return attempt > 1 ? 'retrying' : 'running'
  return 'failed'
}

export async function liveWorkflowRuns(): Promise<{ runs: WorkflowRunView[]; source: DataSource }> {
  const exec = executor()
  const workspaceId = await workspaceScope(exec)
  if (workspaceId === null) return { runs: [], source: 'service' }
  const result = await exec(
    `SELECT run_id, workflow_id, workspace_id, trigger_payload, attempt, status, started_at, finished_at, steps
     FROM workflow_runs
     WHERE workspace_id = $1 AND deleted_at IS NULL
     ORDER BY started_at DESC
     LIMIT 50`,
    [workspaceId],
  )

  const runs = result.rows.map((raw): WorkflowRunView => {
    const row = raw as RunRow
    const startedAt = iso(row.started_at)
    const finishedAt = row.finished_at === null ? undefined : iso(row.finished_at)
    const steps = Array.isArray(row.steps) ? row.steps : []
    const auditEvents: AuditEventRef[] = [
      { id: `${row.run_id}:started`, kind: 'workflow_started', at: startedAt },
      ...steps.map((step): AuditEventRef => ({
        id: `${row.run_id}:${step.stepId}`,
        kind: 'step_completed',
        at: step.finishedAt ?? step.startedAt ?? startedAt,
        ...(step.error === undefined ? {} : { detail: `step ${step.stepId}: ${step.error}` }),
      })),
      ...(finishedAt === undefined
        ? []
        : [{ id: `${row.run_id}:finished`, kind: 'run_finished' as const, at: finishedAt }]),
    ]
    return {
      id: row.run_id,
      workspaceId: row.workspace_id,
      workflowId: row.workflow_id,
      agentId: steps[0]?.agentId ?? 'workflow',
      trigger: (['schedule', 'webhook', 'manual'] as const).includes(row.trigger_payload?.kind as WorkflowTrigger)
        ? (row.trigger_payload.kind as WorkflowTrigger)
        : 'manual',
      status: runStatus(row.status, row.attempt),
      startedAt,
      durationMs:
        finishedAt === undefined ? null : Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      retries: Math.max(0, row.attempt - 1),
      auditEvents,
    }
  })
  return { runs, source: 'service' }
}

// ── Approval queue ──────────────────────────────────────────────────────────

function payloadSummary(request: GateRequestRecord): string {
  const payload = request.payload
  if (payload === null || payload === undefined) return request.reason
  if (Array.isArray(payload)) return `${payload.length} record(s) · ${request.reason}`
  if (typeof payload === 'object') {
    const keys = Object.keys(payload as Record<string, unknown>)
    return `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? `, +${keys.length - 3} more` : ''} · ${request.reason}`
  }
  return request.reason
}

export async function liveApprovalQueue(): Promise<{ items: ApprovalItemView[]; source: DataSource }> {
  const exec = executor()
  const store = new PgApprovalStore(exec)
  const workspaceId = await workspaceScope(exec)
  if (workspaceId === null) return { items: [], source: 'service' }

  const requests = (await store.allRequests()).filter((request) => request.workspaceId === workspaceId)
  const items = await Promise.all(
    requests.map(async (request): Promise<ApprovalItemView> => {
      const decisions = await store.listDecisions(request.id, request.workspaceId)
      const decision = decisions.at(-1)
      const status: ApprovalItemView['status'] =
        request.state === 'approved' ? 'approved' : request.state === 'pending' ? 'pending' : 'rejected'
      return {
        id: request.id,
        workspaceId: request.workspaceId,
        action: request.action,
        reason: request.reason,
        requestedBy: request.requestedBy,
        requestedAt: iso(request.createdAt),
        payloadSummary: payloadSummary(request),
        status,
        ...(decision === undefined
          ? {}
          : {
              decidedBy: decision.approver,
              decidedAt: iso(decision.decidedAt),
              ...(decision.note === undefined ? {} : { note: decision.note }),
            }),
      }
    }),
  )
  return { items, source: 'service' }
}

// ── Credits ─────────────────────────────────────────────────────────────────

export async function liveCredits(): Promise<{ credits: CreditsView; source: DataSource }> {
  const exec = executor()
  const workspaceId = await workspaceScope(exec)
  if (workspaceId === null) {
    return {
      credits: {
        workspaceId: '',
        balanceCredits: 0,
        periodLabel: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        breakdown: [],
        transactions: [],
      },
      source: 'service',
    }
  }

  const [balanceResult, breakdownResult, transactionsResult] = await Promise.all([
    exec(
      `SELECT balance_credits FROM credit_balances WHERE workspace_id = $1 AND deleted_at IS NULL`,
      [workspaceId],
    ),
    exec(
      `SELECT tool, model, COUNT(*)::int AS calls, SUM(units)::int AS units, SUM(cost_credits)::float8 AS cost
       FROM usage_records WHERE workspace_id = $1
       GROUP BY tool, model ORDER BY SUM(cost_credits) DESC`,
      [workspaceId],
    ),
    exec(
      `SELECT id, kind, delta_credits, note, created_at FROM credit_transactions
       WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [workspaceId],
    ),
  ])

  const balanceRow = balanceResult.rows[0] as { balance_credits: string } | undefined
  const credits: CreditsView = {
    workspaceId,
    balanceCredits: balanceRow === undefined ? 0 : Number(balanceRow.balance_credits),
    periodLabel: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    breakdown: breakdownResult.rows.map((raw) => {
      const row = raw as { tool: string; model: string; calls: number; units: number; cost: number }
      return { tool: row.tool, model: row.model, calls: row.calls, units: row.units, costCredits: row.cost }
    }),
    transactions: transactionsResult.rows.map((raw) => {
      const row = raw as { id: string; kind: 'usage' | 'topup' | 'adjustment'; delta_credits: string; note: string | null; created_at: Date }
      return {
        id: row.id,
        kind: row.kind,
        deltaCredits: Number(row.delta_credits),
        createdAt: iso(row.created_at),
        ...(row.note === null ? {} : { note: row.note }),
      }
    }),
  }
  return { credits, source: 'service' }
}

// ── Approval decision (the one write the dashboard may make) ────────────────

/**
 * Records a human decision through the deployment's Postgres-backed gate —
 * the same audited decide path the e2e and the wired service route use.
 * Deciding a non-pending request is a typed 409; an unknown id a typed 404.
 */
export async function decideInPostgres(input: DecisionInput): Promise<DecisionOutcome> {
  const exec = executor()
  const store = new PgApprovalStore(exec)
  const gate = createApprovalGate({ store })

  const request = (await store.allRequests()).find((candidate) => candidate.id === input.id)
  if (!request) throw new UnknownApprovalError(input.id)
  if (request.state !== 'pending') throw new AlreadyDecidedError(input.id)

  const decision = await gate.decide({
    workspaceId: request.workspaceId,
    requestId: request.id,
    outcome: input.approved ? 'approve' : 'deny',
    approver: input.approver,
    ...(input.note === undefined ? {} : { note: input.note }),
  })
  return {
    id: request.id,
    approved: decision.outcome === 'approved',
    approver: decision.approver,
    decidedAt: iso(decision.decidedAt),
    ...(decision.note === undefined ? {} : { note: decision.note }),
    via: 'postgres',
  }
}
