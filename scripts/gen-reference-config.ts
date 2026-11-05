/**
 * Regenerates the reference deployment's compiled workflow artifacts from the
 * Display Factory Wholesale intake fixture (spec D5). Run from the repo root:
 *
 *   corepack pnpm exec tsx scripts/gen-reference-config.ts
 *
 * Outputs, under deployments/reference/:
 *  - workflow.yaml    — current compiled config, human-reviewable
 *  - history.jsonl    — append-only version audit log (one record per version)
 *
 * Uses the production versioning path (persistCompiledConfig + the file
 * version store), so the committed artifact IS the deployment's config
 * directory. The e2e cycle recompiles the same intake and asserts
 * byte-equality against the committed YAML: any behavior change must arrive
 * as a new config version, never a silent edit (spec locked decision 12).
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldMap, FileConfigVersionStore, persistCompiledConfig } from '@bloom/svc-config'

const repoRoot = process.cwd()
const configDir = join(repoRoot, 'deployments/reference')
const fieldMap = FieldMap.fromCsv(
  readFileSync(join(repoRoot, 'templates', 'customer-intake', '08-field-map-internal.csv'), 'utf8'),
)
const intake = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/intake/reference.intake.json'), 'utf8'))

mkdirSync(configDir, { recursive: true })
const { record, changed } = persistCompiledConfig(new FileConfigVersionStore(configDir), intake, fieldMap, {
  customer: 'display-factory-wholesale',
})

console.log(`deployments/reference/workflow.yaml — config v${record.version} (${changed ? 'new version appended' : 'unchanged'})`)
console.log(`  intakeChecksum: ${record.intakeChecksum}`)
console.log(`  yamlChecksum:   ${record.yamlChecksum}`)
