import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Minimal SQL migration runner for the Bloom data layer.
 *
 * The runner takes an injected `executor` so it stays dependency-free — pass
 * a `pg.Pool.query` (or any client returning `{ rowCount }`). Migrations run
 * once each, in filename order, inside a transaction, recorded in
 * `_bloom_migrations`. That bookkeeping table is created by the runner itself,
 * not by a versioned migration file, so every versioned table satisfies the
 * day-one table invariants (see columns.ts).
 */

export interface Migration {
  /** Filename, e.g. `0002_credit_ledger.sql` — applied in lexical order. */
  readonly name: string
  readonly sql: string
}

/**
 * Executes one SQL statement against the target database and returns the
 * client's raw result — `pg` results carry a `rowCount` field.
 */
export type MigrationExecutor = (sql: string) => Promise<unknown>

export interface RunMigrationsResult {
  applied: string[]
  skipped: string[]
}

export class MigrationRunner {
  private readonly executed: MigrationExecutor

  constructor(executor: MigrationExecutor) {
    this.executed = executor
  }

  async run(migrations: readonly Migration[]): Promise<RunMigrationsResult> {
    await this.executed(
      'CREATE TABLE IF NOT EXISTS _bloom_migrations (' +
        'name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )

    const applied: string[] = []
    const skipped: string[] = []
    for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
      if (await this.isApplied(migration.name)) {
        skipped.push(migration.name)
        continue
      }
      // One transaction per migration: a failed migration leaves no partial DDL.
      await this.executed('BEGIN')
      try {
        await this.executed(migration.sql)
        await this.executed(insertApplied(migration.name))
        await this.executed('COMMIT')
        applied.push(migration.name)
      } catch (error) {
        await this.executed('ROLLBACK')
        throw error
      }
    }
    return { applied, skipped }
  }

  private async isApplied(name: string): Promise<boolean> {
    const result = await this.executed(
      `SELECT 1 FROM _bloom_migrations WHERE name = '${escapeLiteral(name)}'`,
    )
    return rowCount(result) > 0
  }
}

function insertApplied(name: string): string {
  return `INSERT INTO _bloom_migrations (name) VALUES ('${escapeLiteral(name)}')`
}

function rowCount(result: unknown): number {
  if (typeof result === 'object' && result !== null && 'rowCount' in result) {
    return Number((result as { rowCount: unknown }).rowCount ?? 0)
  }
  return 0
}

function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

/** Loads versioned migrations from a directory (`.sql` files, sorted by name). */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(
    files.map(async (name) => ({ name, sql: await readFile(join(dir, name), 'utf8') })),
  )
}
