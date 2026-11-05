-- Bloom v1.0 data layer — knowledge chunks with pgvector embeddings.
-- Seed table for the market-map / knowledge-base surface (Revenue Intelligence
-- agent). Shows the embedding pattern every later content table follows.

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  text NOT NULL,
  source        text NOT NULL,
  content       text NOT NULL,
  embedding     vector(1536),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- audit columns (every table, day one)
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL DEFAULT 'system',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT 'system',
  -- soft delete (every table, day one)
  deleted_at    timestamptz,
  deleted_by    text
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_workspace_idx
  ON knowledge_chunks (workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;
