/**
 * Typed schemas — the vocabulary every Bloom skill and tool declares its
 * inputs and outputs with (spec D3: "every skill has typed schemas").
 *
 * Dependency-free on purpose: the contract must stay portable across runtimes
 * (Hermes now, Mastra in v2.0) and into the intake compiler, which validates
 * the same shapes. Structural, runtime-checkable, and strict about required
 * fields so malformed configs fail at the boundary instead of mid-workflow.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'object'
  | 'object[]'

export interface FieldSpec {
  readonly type: FieldType
  readonly description: string
  /** Default false — optional fields may be absent; required fields must be present. */
  readonly required?: boolean
}

export type SchemaSpec = Readonly<Record<string, FieldSpec>>

export interface SchemaViolation {
  readonly path: string
  readonly problem: string
}

export type SchemaValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly SchemaViolation[] }

const FIELD_TYPES: readonly FieldType[] = [
  'string',
  'number',
  'boolean',
  'string[]',
  'number[]',
  'object',
  'object[]',
]

/** Returns the problems that make a SchemaSpec unusable; an empty list means valid. */
export function schemaSpecProblems(spec: unknown): string[] {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['schema must be an object of field specs']
  }
  const problems: string[] = []
  for (const [field, fieldSpec] of Object.entries(spec)) {
    if (fieldSpec === null || typeof fieldSpec !== 'object' || Array.isArray(fieldSpec)) {
      problems.push(`${field}: field spec must be an object`)
      continue
    }
    const { type, description } = fieldSpec as { type?: unknown; description?: unknown }
    if (!FIELD_TYPES.includes(type as FieldType)) {
      problems.push(`${field}: unknown type "${String(type)}"`)
    }
    if (typeof description !== 'string' || description.length === 0) {
      problems.push(`${field}: description is required`)
    }
  }
  return problems
}

function matchesType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'string[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
    case 'number[]':
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'number' && Number.isFinite(item))
      )
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'object[]':
      return (
        Array.isArray(value) &&
        value.every(
          (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
        )
      )
  }
}

/**
 * Validates an untrusted value against a SchemaSpec. Only declared fields are
 * checked; undeclared keys pass through so configs can evolve without breaking
 * older validators.
 */
export function validateAgainstSchema(spec: SchemaSpec, value: unknown): SchemaValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      violations: [{ path: '$', problem: 'expected an object' }],
    }
  }
  const violations: SchemaViolation[] = []
  const record = value as Record<string, unknown>
  for (const [name, field] of Object.entries(spec)) {
    const present = name in record && record[name] !== undefined
    if (!present) {
      if (field.required === true) {
        violations.push({ path: name, problem: 'required field is missing' })
      }
      continue
    }
    if (!matchesType(field.type, record[name])) {
      violations.push({ path: name, problem: `expected ${field.type}` })
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

/** Formats violations into a single readable error line. */
export function formatViolations(check: { readonly ok: false; readonly violations: readonly SchemaViolation[] }): string {
  return check.violations.map((violation) => `${violation.path}: ${violation.problem}`).join('; ')
}
