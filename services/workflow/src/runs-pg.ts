/**
 * SQL-backed workflow run persistence over `workflow_runs` (migration 0005).
 * The WorkflowInterface contract promises a record per run with per-step
 * traces — this is where those records live in the compose deployment, and
 * what the ops dashboard's runs view reads.
 */

import type { SqlExecutor } from '@bloom/db'
import type { AutomationTrigger, WorkflowRunRecord, WorkflowStepTrace } from '@bloom/interfaces'

interface WorkflowRunRow {
  run_id: string
  workflow_id: string
  workspace_id: string
  trigger_payload: unknown
  attempt: number
  status: string
  started_at: Date | string
  finished_at: Date | string | null
  steps: unknown
  result: unknown
}

function isoOrNull(value: Date | string | null): string | undefined {
  if (value === null || value === undefined) return undefined
  return value instanceof Date ? value.toISOString() : String(value)
}

function recordFromRow(row: WorkflowRunRow): WorkflowRunRecord {
  return {
    runId: row.run_id,
    workflowId: row.workflow_id,
    workspaceId: row.workspace_id,
    trigger: row.trigger_payload as AutomationTrigger,
    attempt: row.attempt,
    status: row.status as WorkflowRunRecord['status'],
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
    steps: row.steps as WorkflowStepTrace[],
    result: row.result as WorkflowRunRecord['result'],
  }
}

export class PgWorkflowRunStore {
  constructor(private readonly exec: SqlExecutor) {}

  /** Idempotent per (workspace_id, run_id): retries overwrite their earlier record. */
  async save(record: WorkflowRunRecord): Promise<void> {
    await this.exec(
      `INSERT INTO workflow_runs
         (workspace_id, run_id, workflow_id, trigger_payload, attempt, status, started_at, finished_at, steps, result, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'bloom-engine')
       ON CONFLICT (workspace_id, run_id) DO UPDATE SET
         attempt = EXCLUDED.attempt, status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
         steps = EXCLUDED.steps, result = EXCLUDED.result, updated_at = now(), updated_by = 'bloom-engine'`,
      [
        record.workspaceId,
        record.runId,
        record.workflowId,
        JSON.stringify(record.trigger),
        record.attempt,
        record.status,
        record.startedAt,
        record.finishedAt ?? null,
        JSON.stringify(record.steps),
        record.result ? JSON.stringify(record.result) : null,
      ],
    )
  }

  async listForWorkspace(workspaceId: string, limit = 25): Promise<readonly WorkflowRunRecord[]> {
    const result = await this.exec(
      `SELECT run_id, workflow_id, workspace_id, trigger_payload, attempt, status, started_at, finished_at, steps, result
       FROM workflow_runs
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY started_at DESC, created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    )
    return result.rows.map((row) => recordFromRow(row as WorkflowRunRow))
  }
}
