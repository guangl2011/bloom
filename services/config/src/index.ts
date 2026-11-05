/**
 * @bloom/svc-config — the per-customer customization contract (spec D3).
 *
 * Flow: customer intake workbook (D2) → intake.json → compiled, versioned,
 * traceable YAML workflow config. The D2 field map (tools/intake/generate.py,
 * consumed read-only) is the source of truth this package compiles against.
 *
 * This is a library, not a runtime service: services/workflow and
 * services/agents import it; onboarding tooling calls compileWorkflowConfig
 * and persistCompiledConfig at deploy time.
 */
export { FieldMap, FieldMapError, normalizeIntakeKey, parseCsv } from './fieldmap.js'
export type { FieldMapEntry } from './types.js'
export { SERVICE_PACKAGES } from './types.js'
export type { IntakeValue, Json, NormalizedIntake, ServicePackage } from './types.js'
export {
  IntakeValidationError,
  canonicalIntakeJson,
  generateIntakeSchema,
  normalizeIntake,
  validateIntake,
} from './intake-schema.js'
export type { IntakeIssue, IntakeJsonSchema, JsonSchemaNode } from './intake-schema.js'
export { cadenceToCron } from './schedule.js'
export type { CadenceParse } from './schedule.js'
export { DEFAULT_SCHEDULES, DEFAULT_TIERS, PROJECTIONS, projectIntake } from './mapping.js'
export type { ProjectionResult } from './mapping.js'
export type { Projection, Provenance } from './types.js'
export {
  TraceabilityError,
  assertTraceable,
  collectLeafPaths,
  compileWorkflowConfig,
  parseWorkflowConfig,
  persistCompiledConfig,
} from './compiler.js'
export type { CompileOptions, CompiledConfig, PersistOptions, WorkflowConfig } from './compiler.js'
export { ConfigVersionError, FileConfigVersionStore, sha256 } from './versioning.js'
export type { ConfigVersionRecord, ConfigVersionStore } from './versioning.js'
export { asText, asPositiveInt, approvalGatedMode, cronFromCadence, extractEmails, parseLanguages } from './transforms.js'
export type { ReportLanguage } from './transforms.js'
