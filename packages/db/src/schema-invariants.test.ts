import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import { AUDIT_COLUMNS, SOFT_DELETE_COLUMNS } from './columns'

/**
 * Schema invariant (spec locked decision 11): every table defined by a
 * versioned migration must carry id, workspace_id, audit columns and
 * soft-delete columns. This parses the DDL itself so the check runs in plain
 * CI without a database — a new table missing the columns fails here, before
 * it can reach a deployment.
 */

const MIGRATIONS_DIR = join(fileURLToPath(import.meta.url), '../../migrations')

interface TableDef {
  name: string
  columns: Set<string>
}

/** Strips `--` comments (full-line AND trailing) so commented-out DDL is
 * never treated as active and inline annotations cannot corrupt parsing. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

/**
 * Splits a column-definition list on top-level commas — commas inside
 * `numeric(14, 4)` or `vector(1536)` type arguments do not split.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

const CONSTRAINT_PREFIXES = ['constraint', 'primary key', 'unique', 'check', 'foreign key', 'exclude']

function extractTables(sql: string): TableDef[] {
  const tables: TableDef[] = []
  const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(/gi
  for (const match of sql.matchAll(createTable)) {
    const name = match[1]
    if (!name) continue
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    for (end = start; end < sql.length && depth > 0; end += 1) {
      if (sql[end] === '(') depth += 1
      if (sql[end] === ')') depth -= 1
    }
    const body = sql.slice(start, end - 1)
    const columns = new Set<string>()
    for (const definition of splitTopLevel(body)) {
      const trimmed = definition.trim()
      if (!trimmed) continue
      const firstToken = (trimmed.match(/^\w+/)?.[0] ?? '').toLowerCase()
      if (CONSTRAINT_PREFIXES.includes(firstToken)) continue
      columns.add(firstToken)
    }
    tables.push({ name, columns })
  }
  return tables
}

async function loadAllTables(): Promise<TableDef[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const tables: TableDef[] = []
  for (const file of files) {
    const sql = stripComments(await readFile(join(MIGRATIONS_DIR, file), 'utf8'))
    tables.push(...extractTables(sql))
  }
  return tables
}

describe('schema invariants (day-one tenancy discipline)', () => {
  it('defines at least one versioned table (guard against a silent empty schema)', async () => {
    const tables = await loadAllTables()
    expect(tables.length).toBeGreaterThan(0)
  })

  it('carries id, workspace_id, audit and soft-delete columns on every table', async () => {
    const tables = await loadAllTables()
    const required = ['id', 'workspace_id', ...AUDIT_COLUMNS, ...SOFT_DELETE_COLUMNS]
    const failures = tables.flatMap((table) =>
      required
        .filter((column) => !table.columns.has(column))
        .map((column) => `${table.name}: missing ${column}`),
    )
    expect(failures, 'tables violating day-one invariants').toEqual([])
  })

  it('enables pgvector for the embedding tables', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const sql = await readFile(join(MIGRATIONS_DIR, files[0]!), 'utf8')
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector/i)
  })

  it('rejects a table that lacks the invariant columns (self-test of the checker)', () => {
    const bad = extractTables(`
      CREATE TABLE IF NOT EXISTS no_invariants (
        id uuid PRIMARY KEY,
        payload text
      );
    `)
    const required = ['id', 'workspace_id', ...AUDIT_COLUMNS, ...SOFT_DELETE_COLUMNS]
    const missing = required.filter((column) => !bad[0]!.columns.has(column))
    // The checker must be able to fail — otherwise it verifies nothing.
    expect(missing).not.toEqual([])
  })
})

describe('SOFT_DELETE_COLUMNS / AUDIT_COLUMNS vocabulary', () => {
  it('matches the migration column names', () => {
    expect(AUDIT_COLUMNS).toEqual(['created_at', 'created_by', 'updated_at', 'updated_by'])
    expect(SOFT_DELETE_COLUMNS).toEqual(['deleted_at', 'deleted_by'])
  })
})
