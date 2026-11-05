/**
 * intake.json schema — generated from the D2 field map, plus the normalizer
 * and validator the compiler runs before projecting.
 *
 * The generated JSON Schema documents the contract (every field, its sheet,
 * its required flag). Precise error messages come from validation against the
 * field map: a missing required field names the exact sheet and source row
 * (spec D2 acceptance: "the compiler names the exact sheet/field").
 */
import { FieldMap, normalizeIntakeKey } from './fieldmap.js'
import { SERVICE_PACKAGES } from './types.js'
import type { FieldMapEntry, IntakeValue, Json, NormalizedIntake } from './types.js'

export interface IntakeIssue {
  readonly path: string
  readonly message: string
  readonly sheet: string
  readonly field: string
}

export class IntakeValidationError extends Error {
  readonly issues: readonly IntakeIssue[]

  constructor(issues: readonly IntakeIssue[]) {
    super(
      `intake.json failed validation with ${issues.length} issue(s):\n` +
        issues.map((issue) => `  - [${issue.path || '(root)'}] ${issue.message}`).join('\n'),
    )
    this.issues = issues
  }
}

export interface JsonSchemaNode {
  type?: 'object' | 'string' | 'array'
  anyOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  minItems?: number
  maxItems?: number
  enum?: readonly string[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: false
  description?: string
}

export type IntakeJsonSchema = JsonSchemaNode & { type: 'object' }

/** Fields whose answer is naturally a list (accepts a string or a list of strings). */
const LIST_KEYS: ReadonlySet<string> = new Set([
  'company.branches',
  'company.contacts',
  'company.salesChannels',
  'markets.industries',
  'markets.regions',
  'markets.decisionRoles',
  'markets.exclusions',
  'competitors.list',
  'keywords.monitor',
  'keywords.brand',
  'keywords.competitor',
  'keywords.intent',
  'keywords.exclusions',
  'signals.channels',
  'icp.contactRoles',
  'icp.leadFields',
  'icp.disqualifiers',
  'icp.complianceLimits',
  'approvals.contacts',
])

/** Keyword-count limits per package (template instructions: Starter ≤10, Lead Pro ≤30). */
const MONITOR_KEYWORD_LIMITS: Readonly<Record<(typeof SERVICE_PACKAGES)[number], number>> = {
  intelligence_starter: 10,
  lead_generation_pro: 30,
}

const SEPARATORS = /\r?\n|\t|;|；|、/

function stripNumbering(token: string): string {
  return token.replace(/^\s*\d{1,2}[.、)）]\s*/, '')
}

function normalizeList(text: string): string[] {
  return text
    .split(SEPARATORS)
    .map((token) => stripNumbering(token).trim())
    .filter((token) => token.length > 0)
}

interface SchemaTreeNode {
  node: JsonSchemaNode
  children: Map<string, SchemaTreeNode>
  required: Set<string>
}

function emptyNode(): SchemaTreeNode {
  return { node: {}, children: new Map(), required: new Set() }
}

/**
 * Build the intake JSON Schema from the field map — the schema is derived,
 * never hand-maintained, so it cannot drift from the template.
 */
export function generateIntakeSchema(fieldMap: FieldMap): IntakeJsonSchema {
  const root = emptyNode()
  root.node.type = 'object'
  root.node.additionalProperties = false

  // Group indexed template rows (competitors.list[0..4]) into one array field.
  const indexed = new Map<string, FieldMapEntry[]>()
  for (const entry of fieldMap.entries) {
    const key = normalizeIntakeKey(entry.intakeKey)
    if (key === entry.intakeKey) continue
    const bucket = indexed.get(key) ?? []
    bucket.push(entry)
    indexed.set(key, bucket)
  }

  const addLeaf = (path: string, node: JsonSchemaNode, required: boolean): void => {
    const segments = path.split('.')
    let current = root
    for (const segment of segments.slice(0, -1)) {
      current.node.type = 'object'
      current.node.properties = current.node.properties ?? {}
      const next = current.children.get(segment) ?? emptyNode()
      current.node.properties[segment] = next.node
      current.children.set(segment, next)
      if (required) current.required.add(segment)
      current = next
    }
    const leaf = segments[segments.length - 1]
    if (leaf === undefined) return
    current.node.type = 'object'
    current.node.properties = current.node.properties ?? {}
    current.node.properties[leaf] = node
    if (required) current.required.add(leaf)
  }

  const describe = (entry: FieldMapEntry): string =>
    `${entry.sourceRow}（${entry.sheet}）${entry.required ? ' · 必填 required' : ' · 选填 optional'}`

  for (const entry of fieldMap.entries) {
    const key = entry.intakeKey
    if (!key.includes('[')) {
      const isList = LIST_KEYS.has(key)
      const node: JsonSchemaNode = isList
        ? {
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            description: describe(entry),
          }
        : { type: 'string', description: describe(entry) }
      addLeaf(key, node, entry.required)
    }
  }

  for (const [listKey, rows] of indexed) {
    const required = rows.some((row) => row.required)
    const maxIndex = rows.reduce((max, row) => {
      const match = /\[(\d+)\]$/.exec(row.intakeKey)
      return match?.[1] !== undefined ? Math.max(max, Number(match[1])) : max
    }, 0)
    const node: JsonSchemaNode = {
      type: 'array',
      items: { type: 'string', description: describe(rows[0] as FieldMapEntry) },
      minItems: required ? 1 : undefined,
      maxItems: maxIndex + 1,
      description: describe(rows[0] as FieldMapEntry),
    }
    addLeaf(listKey, node, required)
  }

  const packageNode: JsonSchemaNode = {
    type: 'string',
    enum: [...SERVICE_PACKAGES],
    description: '7.1 服务包 Service package — 决定启用的 Agent 模块 / decides the activated agent modules',
  }
  addLeaf('package', packageNode, true)

  const withRequired = (tree: SchemaTreeNode): JsonSchemaNode => {
    const node = { ...tree.node }
    if (tree.children.size > 0) {
      node.properties = { ...node.properties }
      for (const [segment, child] of tree.children) {
        node.properties[segment] = withRequired(child)
      }
    }
    if (tree.required.size > 0) node.required = [...tree.required].sort()
    return node
  }
  return withRequired(root) as IntakeJsonSchema
}

function coerceScalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * Flatten a nested intake document to dotted keys and coerce answers:
 * list-typed fields accept a string (split on newline/;/；、) or an array;
 * scalars stay strings. Unknown fields (not in the field map) are rejected.
 */
export function normalizeIntake(raw: unknown, fieldMap: FieldMap): NormalizedIntake {
  const issues: IntakeIssue[] = []
  const flat: Record<string, IntakeValue | undefined> = {}

  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) {
      const path = prefix
      if (!fieldMap.coversPath(path)) {
        issues.push({ path, message: `unknown intake field — not in the template field map`, sheet: '', field: '' })
        return
      }
      const items = node.map((item) => coerceScalar(item)).filter((item): item is string => item !== undefined)
      if (items.length !== node.length) {
        issues.push({ path, message: 'list answers must be strings', sheet: '', field: '' })
      }
      if (items.length > 0) flat[path] = items
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix === '' ? key : `${prefix}.${key}`)
      }
      return
    }
    const path = prefix
    if (!fieldMap.coversPath(path)) {
      issues.push({ path, message: `unknown intake field — not in the template field map`, sheet: '', field: '' })
      return
    }
    const scalar = coerceScalar(node)
    if (scalar === undefined) {
      issues.push({ path, message: 'answers must be strings or lists of strings', sheet: '', field: '' })
      return
    }
    if (scalar.trim() === '') {
      flat[path] = undefined
      return
    }
    flat[path] = LIST_KEYS.has(path) ? normalizeList(scalar) : scalar
  }

  walk(raw, '')
  if (issues.length > 0) throw new IntakeValidationError(issues)
  return flat
}

function isFilled(value: IntakeValue | undefined): value is IntakeValue {
  if (value === undefined) return false
  return typeof value === 'string' ? value.trim().length > 0 : value.length > 0
}

function positiveIntOrNull(value: IntakeValue | undefined): number | null {
  const text = typeof value === 'string' ? value : (value?.join(' ') ?? '')
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null
}

/** Indexed template rows (competitors.list[0..4]) cap their list length. */
function listLimits(fieldMap: FieldMap): ReadonlyMap<string, number> {
  const limits = new Map<string, number>()
  for (const entry of fieldMap.entries) {
    const match = /\[(\d+)\]$/.exec(entry.intakeKey)
    if (match?.[1] === undefined) continue
    const key = normalizeIntakeKey(entry.intakeKey)
    limits.set(key, Math.max(limits.get(key) ?? 0, Number(match[1]) + 1))
  }
  return limits
}

/**
 * Enforce the customization contract: every required field present, the
 * package enum, and the per-package limits. Missing required fields name the
 * exact sheet and source row so the customer can fix the workbook without a
 * workshop (spec D2/D3 acceptance).
 */
export function validateIntake(intake: NormalizedIntake, fieldMap: FieldMap): void {
  const issues: IntakeIssue[] = []

  for (const entry of fieldMap.entries) {
    const path = normalizeIntakeKey(entry.intakeKey)
    if (entry.required && !isFilled(intake[path])) {
      issues.push({
        path,
        message: `缺少必填字段 — 请填写「${entry.sheet}」的「${entry.sourceRow}」/ missing required field`,
        sheet: entry.sheet,
        field: entry.sourceRow,
      })
    }
  }

  const pkg = intake['package']
  if (isFilled(pkg) && !SERVICE_PACKAGES.includes(pkg as (typeof SERVICE_PACKAGES)[number])) {
    const entry = fieldMap.entry('package')
    issues.push({
      path: 'package',
      message: `服务包必须是 ${SERVICE_PACKAGES.join(' 或 ')} / must be one of the two service packages`,
      sheet: entry?.sheet ?? '',
      field: entry?.sourceRow ?? '',
    })
  }

  const monitor = intake['keywords.monitor']
  if (Array.isArray(monitor)) {
    const pkgName = (isFilled(pkg) ? pkg : 'lead_generation_pro') as (typeof SERVICE_PACKAGES)[number]
    const limit = MONITOR_KEYWORD_LIMITS[pkgName]
    if (monitor.length > limit) {
      const entry = fieldMap.entry('keywords.monitor')
      issues.push({
        path: 'keywords.monitor',
        message: `监控关键词超过上限：${monitor.length} > ${limit}（${pkgName}）/ keyword limit exceeded`,
        sheet: entry?.sheet ?? '',
        field: entry?.sourceRow ?? '',
      })
    }
  }

  for (const [path, label] of [
    ['icp.monthlyQuota', '每月线索配额 monthly lead quota'],
    ['delivery.dailySendCap', '每日发送上限 daily send cap'],
    ['signals.maxPerPeriod', '每期信号上限 max signals per period'],
  ] as const) {
    const value = intake[path]
    if (isFilled(value) && positiveIntOrNull(value) === null) {
      const entry = fieldMap.entry(path)
      issues.push({
        path,
        message: `${label} 必须是正整数 / must be a positive integer`,
        sheet: entry?.sheet ?? '',
        field: entry?.sourceRow ?? '',
      })
    }
  }

  for (const [path, max] of listLimits(fieldMap)) {
    const value = intake[path]
    if (Array.isArray(value) && value.length > max) {
      const entry = fieldMap.entryForPath(`${path}[0]`)
      issues.push({
        path,
        message: `最多 ${max} 行（模板只有 ${max} 行）/ exceeds the template's ${max} rows`,
        sheet: entry?.sheet ?? '',
        field: entry?.sourceRow ?? '',
      })
    }
  }

  if (issues.length > 0) throw new IntakeValidationError(issues)
}

/** Canonical checksum input for versioning: sorted keys, stable serialization. */
export function canonicalIntakeJson(intake: NormalizedIntake): string {
  const entries = Object.entries(intake)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const asJson: Record<string, Json> = {}
  for (const [key, value] of entries) {
    if (value === undefined) continue
    asJson[key] = typeof value === 'string' ? value : [...value]
  }
  return JSON.stringify(asJson)
}
