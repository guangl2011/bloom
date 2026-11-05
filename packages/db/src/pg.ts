/**
 * node-postgres implementation of the SqlExecutor port (packages/db). The
 * compose deployment and the e2e cycle both use this against compose Postgres;
 * Cloud SQL uses the same driver through the deploy adapter. Stores depend on
 * the SqlExecutor shape, never on this driver.
 */

import { Pool } from 'pg'
import type { SqlExecutor } from './executor'

export function createPgExecutor(pool: Pool): SqlExecutor {
  return async (sql, params) => {
    const result = await pool.query(sql, params === undefined ? [] : [...params])
    // Multi-statement strings (e.g. a whole migration file in one exec) come
    // back as an array of results — flatten to one rows/rowCount shape.
    if (Array.isArray(result)) {
      return {
        rows: result.flatMap((entry) => [...(entry.rows ?? [])]),
        rowCount: result.reduce((sum, entry) => sum + (entry.rowCount ?? 0), 0),
      }
    }
    const rows: unknown[] = [...result.rows]
    return { rows, rowCount: result.rowCount ?? rows.length }
  }
}

/** Creates the default executor from a connection string (compose default: postgres://bloom:bloom@localhost:5432/bloom). */
export function createPgExecutorFromUrl(connectionString: string): { exec: SqlExecutor; pool: Pool } {
  const pool = new Pool({ connectionString })
  return { exec: createPgExecutor(pool), pool }
}
