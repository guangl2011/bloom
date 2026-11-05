-- Bloom v1.0 — approval-gate persistence (spec deliverable D3, locked decision 10).
-- The approval service's in-memory store is the test default; this migration
-- gives the compose deployment durable requests, decisions, and audit rows.
-- Every high-risk action's gate cycle — request → decision → authorization —
-- must survive process restarts, or the audit trail is not an audit trail.

CREATE TABLE IF NOT EXISTS gate_requests (
  id                   text PRIMARY KEY,          -- 'req_<uuid>' minted by the gate
  workspace_id         text NOT NULL,
  action               text NOT NULL,
  reason               text NOT NULL,
  requested_by         text NOT NULL,
  requested_at         timestamptz NOT NULL,
  skill                jsonb,                     -- {name, version} of the producing skill
  payload              jsonb,
  payload_fingerprint  text NOT NULL,
  expires_at           timestamptz NOT NULL,
  state                text NOT NULL CHECK (state IN ('pending', 'approved', 'denied', 'expired')),
  -- audit columns (every table, day one)
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL DEFAULT 'system',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at           timestamptz,
  deleted_by           text
);

CREATE INDEX IF NOT EXISTS gate_requests_workspace_idx
  ON gate_requests (workspace_id, state, requested_at DESC)
  WHERE deleted_at IS NULL;

-- One row per human decision; the gate never mutates a decided request except
-- to consume it (consumed_at), mirroring the store contract.
CREATE TABLE IF NOT EXISTS gate_decisions (
  id            text PRIMARY KEY,                 -- 'dec_<uuid>' minted by the gate
  request_id    text NOT NULL,
  workspace_id  text NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  approver      text NOT NULL,
  decided_at    timestamptz NOT NULL,
  note          text,
  valid_until   timestamptz,
  consumed_at   timestamptz,
  -- audit columns (every table, day one)
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL DEFAULT 'system',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at    timestamptz,
  deleted_by    text
);

CREATE INDEX IF NOT EXISTS gate_decisions_request_idx
  ON gate_decisions (request_id, decided_at DESC)
  WHERE deleted_at IS NULL;

-- Append-only gate audit trail. seq gives a stable total order for events that
-- share a timestamp; rows are never updated or deleted in place.
CREATE TABLE IF NOT EXISTS gate_audit (
  id            text PRIMARY KEY,                 -- 'aud_<uuid>' minted by the gate
  workspace_id  text NOT NULL,
  seq           bigserial NOT NULL,
  created_at    timestamptz NOT NULL,             -- the audit entry's event time
  created_by    text NOT NULL DEFAULT 'system',
  event         text NOT NULL,
  actor         text NOT NULL,
  request_id    text,
  detail        jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at    timestamptz,
  deleted_by    text,
  UNIQUE (seq)
);

CREATE INDEX IF NOT EXISTS gate_audit_workspace_seq_idx
  ON gate_audit (workspace_id, seq);
