/**
 * Test support: load the real field-map CSV (the compiler's source of truth)
 * and the reference Lead Pro intake fixture. Kept outside index.ts — test-only.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldMap } from './fieldmap.js'
import type { Json } from './types.js'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(PKG_ROOT, '..', '..')

export function loadFieldMap(): FieldMap {
  const csv = readFileSync(join(REPO_ROOT, 'templates', 'customer-intake', '08-field-map-internal.csv'), 'utf8')
  return FieldMap.fromCsv(csv)
}

export function loadReferenceIntake(): Record<string, Json> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'intake', 'reference.intake.json'), 'utf8')) as Record<
    string,
    Json
  >
}

/** Raw field-map CSV text, for tests that tamper with the template. */
export function loadFieldMapCsvText(): string {
  return readFileSync(join(REPO_ROOT, 'templates', 'customer-intake', '08-field-map-internal.csv'), 'utf8')
}
