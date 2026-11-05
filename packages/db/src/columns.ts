/**
 * Day-one table invariants (spec locked decision 11): every table in every
 * migration carries id, workspace_id, audit columns and soft-delete columns,
 * so the v2.0 multi-tenant upgrade is a data-layer migration, not a rewrite.
 *
 * The SQL migrations are the source of truth; these constants exist so code
 * and tests share one vocabulary with `packages/db/migrations/*.sql`.
 */

export const AUDIT_COLUMNS = [
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
] as const

export const SOFT_DELETE_COLUMNS = ['deleted_at', 'deleted_by'] as const

/** Columns every Bloom table must define, verified by schema-invariants test. */
export const REQUIRED_TABLE_COLUMNS = [
  'id',
  'workspace_id',
  ...AUDIT_COLUMNS,
  ...SOFT_DELETE_COLUMNS,
] as const

export type RequiredTableColumn = (typeof REQUIRED_TABLE_COLUMNS)[number]
