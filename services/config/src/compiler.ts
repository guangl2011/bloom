/**
 * Intake compiler: a customer's intake.json + the D2 field map → a versioned,
 * traceable YAML workflow config (spec deliverable D3, reference config shape).
 *
 * Two guarantees, both enforced at compile time and CI-tested:
 *  1. Traceability — every emitted config key is either projected from an
 *     intake field through the field map, or part of the reserved platform
 *     envelope (scan-engine selection, scoring model id, approval gates).
 *     Orphan keys fail compilation.
 *  2. Invariants — approval gates are always the full fixed list and outreach
 *     is always approval-gated, whatever the intake says (never config-off).
 */
import { GATE_ACTIONS } from '@bloom/interfaces'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { FieldMap } from './fieldmap.js'
import { canonicalIntakeJson, normalizeIntake, validateIntake } from './intake-schema.js'
import { DEFAULT_TIERS, projectIntake } from './mapping.js'
import type { ProjectionResult } from './mapping.js'
import { sha256 } from './versioning.js'
import type { ConfigVersionRecord, ConfigVersionStore } from './versioning.js'
import type { Json, NormalizedIntake, Provenance, ServicePackage } from './types.js'

export class TraceabilityError extends Error {}

/**
 * Platform-envelope paths: scan-engine selection is config-not-code (AGENTS.md
 * invariant), the scoring model is internal_v1 with spec-default tiers (locked
 * decisions 3–4), approval gates are hard invariants (locked decision 10),
 * ads platforms are read-only recommendations for Google/LinkedIn only (locked
 * decision 6), and version/customer are compiler envelope, not answers.
 */
const RESERVED_PATHS: readonly string[] = [
  'version',
  'customer',
  'approval.gate_actions',
  'workflow.purchase_signals.engine',
  'workflow.lead_scoring.model',
  'workflow.lead_scoring.tiers',
  'ads.platforms',
]

function isReserved(path: string): boolean {
  // Indexed elements inherit the root's reserved status: gate_actions[2] is as
  // compiler-owned as gate_actions itself.
  const structural = path.replace(/\[\d+\]/g, '')
  return RESERVED_PATHS.some((reserved) => structural === reserved || structural.startsWith(`${reserved}.`))
}

/** Collect leaf paths of a config tree (arrays report their index paths). */
export function collectLeafPaths(value: Json, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectLeafPaths(item, `${prefix}[${index}]`))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => collectLeafPaths(child, prefix === '' ? key : `${prefix}.${key}`))
  }
  return [prefix]
}

/**
 * The traceability guard. Fails on:
 *  - provenance rows whose field-map config key does not exist in the live CSV
 *    (projection table drifted from the template), or
 *  - emitted leaves with no provenance and no reserved envelope claim (orphans).
 */
export function assertTraceable(
  config: Record<string, Json>,
  provenance: readonly Provenance[],
  fieldMap: FieldMap,
): void {
  const untracedProvenance = provenance.filter((row) => !fieldMap.configKeys.has(row.tracesTo))
  if (untracedProvenance.length > 0) {
    throw new TraceabilityError(
      'projection table references config keys absent from the field map (orphan provenance):\n' +
        untracedProvenance
          .map((row) => `  - ${row.path} claims "${row.tracesTo}" — not in the field map CSV`)
          .join('\n'),
    )
  }

  const tracedPaths = new Set(provenance.map((row) => row.path))
  // One intake field feeding a split/transform covers every element of the
  // emitted array — a keywords textarea → market_intel.keywords[i].
  const isCovered = (path: string): boolean =>
    tracedPaths.has(path) || (path.lastIndexOf('[') > 0 && isCovered(path.slice(0, path.lastIndexOf('['))))
  const orphans = collectLeafPaths(config).filter((path) => !isCovered(path) && !isReserved(path))
  if (orphans.length > 0) {
    throw new TraceabilityError(
      'emitted config contains keys that trace to no intake field (orphan keys):\n' +
        orphans.map((path) => `  - ${path}`).join('\n'),
    )
  }
}

export interface WorkflowConfig extends Record<string, Json> {
  version: number
  customer: string
  package: ServicePackage
  workflow: Record<string, Json>
  approval: Record<string, Json>
  agent_roster: Json
}

export interface CompileOptions {
  /** Deployment slug (ops-assigned, e.g. `reference-medspa`) — envelope, not an intake answer. */
  customer: string
  version: number
}

export interface CompiledConfig {
  config: WorkflowConfig
  yaml: string
  provenance: readonly Provenance[]
  intakeChecksum: string
}

/** Compile intake.json into the workflow config; throws on validation or traceability failure. */
export function compileWorkflowConfig(rawIntake: unknown, fieldMap: FieldMap, options: CompileOptions): CompiledConfig {
  const intake: NormalizedIntake = normalizeIntake(rawIntake, fieldMap)
  validateIntake(intake, fieldMap)

  const pkg = intake['package']
  if (typeof pkg !== 'string') {
    throw new TraceabilityError('package is required and must be a string') // validation guarantees this
  }

  const projected: ProjectionResult = projectIntake(intake, pkg as ServicePackage)
  if (projected.package !== pkg) {
    throw new TraceabilityError('package projection missing — projection table drifted') // table guarantees this
  }

  const engine = { primary: 'obvious', fallback: 'deepline' }
  const signals = projected.config.workflow['purchase_signals']
  const signalsObject =
    typeof signals === 'object' && signals !== null && !Array.isArray(signals)
      ? (signals as Record<string, Json>)
      : undefined
  if (signalsObject !== undefined) signalsObject['engine'] = engine

  const leadScoring = projected.config.workflow['lead_scoring']
  const leadScoringObject =
    typeof leadScoring === 'object' && leadScoring !== null && !Array.isArray(leadScoring)
      ? (leadScoring as Record<string, Json>)
      : undefined
  if (leadScoringObject !== undefined) {
    leadScoringObject['model'] = 'internal_v1'
    leadScoringObject['tiers'] = { ...DEFAULT_TIERS }
  }

  // Hard invariant (locked decision 10): the full gate list, always, never config-off.
  projected.config.approval['gate_actions'] = [...GATE_ACTIONS]
  if (projected.config.ads !== undefined) {
    projected.config.ads['platforms'] = ['google', 'linkedin']
  }

  const config: WorkflowConfig = {
    version: options.version,
    customer: options.customer,
    package: pkg as ServicePackage,
    workflow: projected.config.workflow,
    approval: projected.config.approval,
    agent_roster: projected.agent_roster ?? [],
  }
  for (const section of ['knowledge_base', 'crm', 'compliance', 'report', 'delivery', 'ads'] as const) {
    const value = projected.config[section]
    if (value !== undefined) config[section] = value
  }

  assertTraceable(config, projected.provenance, fieldMap)

  const yaml = stringifyYaml(config, { lineWidth: 0 }).trimEnd() + '\n'
  return { config, yaml, provenance: projected.provenance, intakeChecksum: sha256(canonicalIntakeJson(intake)) }
}

export interface PersistOptions {
  customer: string
  /** Clock at the edge — injected for deterministic tests and audit timestamps. */
  now?: () => string
}

/**
 * Compile and version in one step: unchanged intake → current record returned
 * as-is (no spurious version); changed intake → new version appended.
 */
export function persistCompiledConfig(
  store: ConfigVersionStore,
  rawIntake: unknown,
  fieldMap: FieldMap,
  options: PersistOptions,
): { record: ConfigVersionRecord; changed: boolean } {
  const now = options.now ?? (() => new Date().toISOString())
  const nextVersion = (store.current()?.version ?? 0) + 1
  const compiled = compileWorkflowConfig(rawIntake, fieldMap, { customer: options.customer, version: nextVersion })
  const current = store.current()
  if (current !== undefined && current.intakeChecksum === compiled.intakeChecksum) {
    return { record: current, changed: false }
  }
  return { record: store.append(compiled.yaml, compiled.intakeChecksum, now()), changed: true }
}

/** Parse a workflow config YAML back to its object form (round-trip helper). */
export function parseWorkflowConfig(yaml: string): Record<string, Json> {
  const parsed: unknown = parseYaml(yaml)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TraceabilityError('workflow config YAML must be a mapping at the top level')
  }
  return parsed as Record<string, Json>
}
