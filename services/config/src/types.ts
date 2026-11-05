/** The two service tiers (增值服务包) a v1.0 deployment can be built from. */
export const SERVICE_PACKAGES = ['intelligence_starter', 'lead_generation_pro'] as const
export type ServicePackage = (typeof SERVICE_PACKAGES)[number]

import type { Json } from './json.js'
export type { Json } from './json.js'
export { isJsonObject } from './json.js'

/** One row of the intake template's internal field map (sheet 08). */
export interface FieldMapEntry {
  readonly no: string
  /** Dotted intake path, e.g. `company.name` or `competitors.list[0]`. */
  readonly intakeKey: string
  readonly sheet: string
  readonly sourceRow: string
  readonly required: boolean
  /** Workflow-config keys (field-map vocabulary) this answer feeds. */
  readonly configKeys: readonly string[]
  readonly agent: string
  readonly note: string
}

/** A customer's answer: free text, or a normalized list of strings. */
export type IntakeValue = string | readonly string[]

/** Normalized intake document: dotted intake key → answer. */
export type NormalizedIntake = Readonly<Record<string, IntakeValue | undefined>>

/**
 * One row of the compiler's projection table: an intake answer lands at one
 * emitted config path, traced to the field-map config key that declares it.
 */
export interface Projection {
  readonly intakeKey: string
  /** Field-map config key proving this emitted path is contract-covered. */
  readonly tracesTo: string
  /** Leaf key appended to the section prefix; omitted for explicit-path scalar projections. */
  readonly leaf?: string
  /** Explicit emitted path for scalars/renames; default: section(tracesTo) + '.' + leaf. */
  readonly path?: string
  /** Package gate — omit the projection entirely for other packages. */
  readonly packages?: readonly ServicePackage[]
  /** Value transform; default passes the answer through untouched. */
  readonly transform?: (value: IntakeValue | undefined) => Json | undefined
}

/** Emitted-path provenance, recorded while projecting and checked by the traceability guard. */
export interface Provenance {
  readonly path: string
  readonly tracesTo: string
  readonly intakeKey: string
}

export class ProjectionError extends Error {}
