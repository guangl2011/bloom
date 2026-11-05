-- Bloom v1.0 data layer — extensions (spec deliverable D3).
-- pgvector backs knowledge-base / market-map embeddings in the v2.0 migration,
-- which is a data-layer change only — hence installed from day one.

CREATE EXTENSION IF NOT EXISTS vector;
