/**
 * SQL executor port — the minimal seam every SQL-backed store programs against.
 * Implementations wrap the deployment's driver (node-postgres on compose and
 * Cloud SQL today); stores depend on this shape, never on the driver, so the
 * same store code runs against compose Postgres and Cloud SQL alike.
 */

export interface SqlResult {
  readonly rows: unknown[]
  readonly rowCount: number
}

/** Tagged-template or call-style execution: SQL text plus positional params. */
export type SqlExecutor = (sql: string, params?: readonly unknown[]) => Promise<SqlResult>
