-- Bloom v1.0 data layer — internal credit accounting (spec deliverable D3).
-- Internal-only: customers never see billing; balances and usage are cost
-- accounting for the operator. workspace_id is present on every table so v2.0
-- multi-tenancy stays a data-layer migration (spec locked decision 11).

-- Balance per workspace. One row per workspace; balance_credits is the live
-- balance and is derived: opening + sum(credit_transactions.delta_credits).
CREATE TABLE IF NOT EXISTS credit_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  balance_credits numeric(14, 4) NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  -- audit columns (every table, day one)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL DEFAULT 'system',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at      timestamptz,
  deleted_by      text,
  UNIQUE (workspace_id)
);

-- One row per priced tool/model call. cost_credits is what the call cost;
-- the reconciliation invariant (see services/credits) requires every priced
-- usage to have a matching credit_transactions row with kind = 'usage'.
CREATE TABLE IF NOT EXISTS usage_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  tool            text NOT NULL,
  model           text NOT NULL,
  units           numeric(14, 4) NOT NULL CHECK (units > 0),
  cost_credits    numeric(14, 4) NOT NULL CHECK (cost_credits > 0),
  workflow_run_id text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- audit columns (every table, day one)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL DEFAULT 'system',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at      timestamptz,
  deleted_by      text
);

CREATE INDEX IF NOT EXISTS usage_records_workspace_created_at_idx
  ON usage_records (workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Balance deltas. kind = 'usage' rows are machine-generated from usage_records;
-- 'topup' and 'adjustment' are operator actions. Every mutation of a balance
-- goes through a transaction row — balances are never edited in place.
CREATE TABLE IF NOT EXISTS credit_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('usage', 'topup', 'adjustment')),
  delta_credits   numeric(14, 4) NOT NULL,
  -- 'usage' transactions link to the priced call that produced them.
  usage_record_id uuid REFERENCES usage_records (id),
  note            text,
  -- audit columns (every table, day one)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL DEFAULT 'system',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at      timestamptz,
  deleted_by      text
);

CREATE INDEX IF NOT EXISTS credit_transactions_workspace_created_at_idx
  ON credit_transactions (workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;
