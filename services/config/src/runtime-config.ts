/**
 * Compiled-workflow → runtime-config mapper (integration glue).
 *
 * The intake compiler (D3c) persists the customer's workflow in versioned
 * snake_case YAML — the customization contract, diff-able and reviewable. The
 * agents (D3b) consume the camelCase WorkflowConfig. This module is the one
 * deterministic translation between the two, so a recompiled intake changes
 * agent behavior without code edits (spec D3 acceptance: config-driven agents).
 *
 * The one non-mechanical step is lead_scoring.tuning → ICP criteria: the
 * compiler stores the customer's own criteria text + percentage weights; the
 * runtime model consumes three named features (product_fit, growth_signal,
 * decision_chain). Weight tokens are mapped to features by keyword; criteria
 * text becomes the feature's human-readable description.
 */

import {
  SERVICE_PACKAGES,
  workflowConfigProblems,
  type IcpCriterion,
  type ServicePackage,
  type WorkflowConfig,
} from '@bloom/interfaces'

/** The JSON shape of the compiled workflow (workflow-config.json / YAML object). */
export type CompiledConfig = Record<string, unknown>

/** Runtime feature names the internal_v1 scoring model and ICP agent key on. */
const CRITERION_IDS = ['product_fit', 'growth_signal', 'decision_chain'] as const
export type RuntimeCriterionId = (typeof CRITERION_IDS)[number]

const CRITERION_KEYWORDS: readonly { readonly id: RuntimeCriterionId; readonly keywords: readonly string[] }[] = [
  { id: 'product_fit', keywords: ['purchase', 'volume', 'product'] },
  { id: 'growth_signal', keywords: ['market', 'growth', 'expansion', 'trial'] },
  { id: 'decision_chain', keywords: ['seniority', 'role', 'decision', 'chain'] },
]

const CRITERION_FIELDS: readonly { readonly id: RuntimeCriterionId; readonly field: string }[] = [
  { id: 'product_fit', field: 'criteria_a' },
  { id: 'growth_signal', field: 'criteria_b' },
  { id: 'decision_chain', field: 'criteria_c' },
]

function section(config: CompiledConfig, key: string): Record<string, unknown> {
  const value = config[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`compiled workflow config is missing the "${key}" section`)
  }
  return value as Record<string, unknown>
}

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`compiled workflow config field "${what}" must be a list of strings`)
  }
  return value as string[]
}

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`compiled workflow config field "${what}" must be a number`)
  }
  return value
}

/**
 * Parses tier bounds from the compiled strings: "A: '>=0.8'" → {min: 0.8},
 * "B: '0.5-0.8'" → {min: 0.5, max: 0.8}. Unknown syntaxes fail loudly — a
 * silently-flipped tier boundary would silently change who gets outreach.
 */
export function parseTierBound(raw: string, tier: string): { min?: number; max?: number } {
  const text = raw.trim()
  const gte = /^>=\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (gte) {
    return { min: Number(gte[1]) }
  }
  const range = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) }
  }
  throw new Error(`lead tier "${tier}" has an unreadable bound "${raw}" — use ">=X" or "X-Y"`)
}

/** Splits tuning text like `"purchase volume 40%, role seniority 30%"` into (token, percent) pairs. */
export function parseWeightTokens(raw: string): readonly { token: string; percent: number }[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const match = /^(.+?)\s+(\d+(?:\.\d+)?)\s*%$/.exec(part)
      if (!match || match[1] === undefined || match[2] === undefined) {
        throw new Error(`lead_scoring.tuning has an unreadable weight "${part}" — use "<text> <N>%" comma-separated`)
      }
      return { token: match[1].trim().toLowerCase(), percent: Number(match[2]) }
    })
}

/**
 * Maps the compiler's tuning block to the runtime ICP criteria. Weight tokens
 * map to the three runtime features by keyword; unmapped tokens (e.g.
 * certifications) are dropped and the remaining weights renormalize — the ICP
 * agent normalizes to sum 1 regardless. With no readable weights at all, the
 * features split evenly rather than guessing at emphasis.
 */
export function icpCriteriaFromTuning(
  tuning: Record<string, unknown>,
): readonly IcpCriterion[] {
  const descriptions = new Map<RuntimeCriterionId, string>(
    CRITERION_FIELDS.flatMap(({ id, field }) => {
      const text = tuning[field]
      return typeof text === 'string' && text.trim().length > 0 ? [[id, text] as const] : []
    }),
  )

  const raw = tuning.weights
  const tokens =
    typeof raw === 'string' && raw.trim().length > 0 ? parseWeightTokens(raw) : []

  const weights = new Map<RuntimeCriterionId, number>()
  for (const { token, percent } of tokens) {
    const criterion = CRITERION_KEYWORDS.find(({ keywords }) =>
      keywords.some((keyword) => token.includes(keyword)),
    )
    if (criterion && !weights.has(criterion.id)) {
      weights.set(criterion.id, percent)
    }
  }
  if (weights.size === 0) {
    for (const id of CRITERION_IDS) weights.set(id, 1)
  }

  return CRITERION_IDS.map((id) => ({
    id,
    description: descriptions.get(id) ?? id,
    weight: weights.get(id) ?? 0,
  }))
}

function scanEngineId(value: unknown, what: string): 'obvious' | 'deepline' {
  if (value !== 'obvious' && value !== 'deepline') {
    throw new Error(`${what} must be 'obvious' or 'deepline', got "${String(value)}"`)
  }
  return value
}

/**
 * Builds the agents' WorkflowConfig from the compiled workflow object.
 * Throws on a structurally incomplete compile — the gate the brief puts
 * between compile and deploy.
 */
export function runtimeConfigFromCompiled(
  compiled: CompiledConfig,
  options: { readonly workspaceId?: string } = {},
): WorkflowConfig {
  const workflow = section(compiled, 'workflow')

  const marketIntel = section(workflow, 'market_intel')
  const keywordsBlock = section(marketIntel, 'keywords')
  const purchaseSignals = section(workflow, 'purchase_signals')
  const engineBlock = section(purchaseSignals, 'engine')
  const scoring = section(workflow, 'lead_scoring')
  const tuning = section(scoring, 'tuning')
  const tiersBlock = section(scoring, 'tiers')
  const outreach = section(workflow, 'outreach')
  // The compiler emits ads as a top-level section, like approval — deployment-
  // level policy, not a per-workflow block.
  const ads = compiled.ads as Record<string, unknown> | undefined
  // The compiler emits approval as a top-level section — it is deployment-level
  // policy, not a per-workflow block.
  const approval = section(compiled, 'approval')

  const tierA = tiersBlock.A
  const tierB = tiersBlock.B
  const tierC = tiersBlock.C
  if (typeof tierA !== 'string' || typeof tierB !== 'string' || typeof tierC !== 'string') {
    throw new Error('lead_scoring.tiers must carry A, B, C bounds')
  }

  const packageName = compiled.package
  if (typeof packageName !== 'string' || !SERVICE_PACKAGES.includes(packageName as ServicePackage)) {
    throw new Error(`compiled workflow config has an unknown package "${String(packageName)}"`)
  }
  const customer = compiled.customer
  if (typeof customer !== 'string' || customer.length === 0) {
    throw new Error('compiled workflow config is missing the customer slug')
  }

  const platforms = ads ? stringList(ads.platforms, 'ads.platforms') : []
  const regions = purchaseSignals.scope
    ? stringList(section(purchaseSignals, 'scope').regions, 'purchase_signals.scope.regions')
    : undefined
  if (regions === undefined) {
    throw new Error('compiled workflow config is missing purchase_signals.scope.regions — the scan scope must come from the intake')
  }

  const channels = outreach.channels === undefined ? ['email'] : stringList(outreach.channels, 'outreach.channels')
  const mode = outreach.mode
  if (mode !== 'approval_gated_send') {
    throw new Error(`outreach.mode must be 'approval_gated_send' (a hard invariant, never config-off), got "${String(mode)}"`)
  }
  const scoringModel = scoring.model
  if (scoringModel !== 'internal_v1') {
    throw new Error(`lead_scoring.model must be 'internal_v1' (locked decision 4), got "${String(scoringModel)}"`)
  }

  const config: WorkflowConfig = {
    workspaceId: options.workspaceId ?? customer,
    customer,
    package: packageName as ServicePackage,
    marketIntel: {
      schedule: typeof marketIntel.schedule === 'string' ? marketIntel.schedule : undefined,
      keywords: stringList(keywordsBlock.monitor, 'workflow.market_intel.keywords.monitor'),
      regions,
    },
    purchaseSignals: {
      schedule: typeof purchaseSignals.schedule === 'string' ? purchaseSignals.schedule : undefined,
      engine: {
        primary: scanEngineId(engineBlock.primary, 'purchase_signals.engine.primary'),
        fallback: scanEngineId(engineBlock.fallback, 'purchase_signals.engine.fallback'),
      },
      maxSignalsPerPeriod: number(purchaseSignals.max_signals_per_period, 'purchase_signals.max_signals_per_period'),
    },
    icp: { criteria: icpCriteriaFromTuning(tuning) },
    leadScoring: {
      model: scoringModel,
      monthlyQuota: number(scoring.monthly_quota, 'lead_scoring.monthly_quota'),
      tiers: {
        A: parseTierBound(tierA, 'A'),
        B: parseTierBound(tierB, 'B'),
        C: parseTierBound(tierC, 'C'),
      },
    },
    outreach: {
      channels: channels.filter((c): c is 'email' => c === 'email'),
      mode,
      dailySendCap:
        typeof outreach.daily_send_cap === 'number' ? outreach.daily_send_cap : 100,
    },
    ads: {
      platforms: platforms.filter((p): p is 'google' | 'linkedin' => p === 'google' || p === 'linkedin'),
    },
    approval: {
      approvers: ((): string[] => {
        const emails = approval.approvers as Record<string, unknown> | undefined
        return emails && Array.isArray(emails.emails) ? (emails.emails as string[]) : []
      })(),
    },
  }

  const problems = workflowConfigProblems(config)
  if (problems.length > 0) {
    throw new Error(`compiled workflow config does not satisfy the runtime contract: ${problems.join('; ')}`)
  }
  return config
}
