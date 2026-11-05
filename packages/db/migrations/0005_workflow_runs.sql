-- Bloom v1.0 — workflow run records (WorkflowInterface: every run produces a
-- record, traceable per-step with timing, status, and errors). The dashboard's
-- runs view and the e2e cycle both read from here; retry bookkeeping lives in
-- the attempt column.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  run_id          text NOT NULL,
  workflow_id     text NOT NULL,
  trigger_payload jsonb NOT NULL,               -- AutomationTrigger (schedule rrule / webhook)
  attempt         integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz,
  steps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  result          jsonb,
  -- audit columns (every table, day one)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL DEFAULT 'system',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at      timestamptz,
  deleted_by      text,
  UNIQUE (workspace_id, run_id)
);

CREATE INDEX IF NOT EXISTS workflow_runs_workspace_started_idx
  ON workflow_runs (workspace_id, started_at DESC)
  WHERE deleted_at IS NULL;
