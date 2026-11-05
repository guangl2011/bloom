import type { IcpCriterion, TierBound } from '@bloom/interfaces'

/** The in-repo scoring model id (spec locked decision 4) — tuned per customer, never per product tier. */
export const SCORING_MODEL = 'internal_v1'

/** Normalized per-criterion weights — the ICP agent's tuning output. */
export type ScoringTuning = Readonly<Record<string, number>>

/** Signal strengths in [0, 1] keyed by ICP criterion id. */
export type LeadSignals = Readonly<Record<string, number>>

export type LeadTier = 'A' | 'B' | 'C' | 'unqualified'

/**
 * Normalizes criteria weights to sum to 1. A non-positive total is a config
 * defect — throws rather than producing a garbage tuning.
 */
export function normalizeCriteriaWeights(criteria: readonly IcpCriterion[]): ScoringTuning {
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  if (!(total > 0)) {
    throw new Error('ICP criteria weights must sum to a positive number')
  }
  const weights: Record<string, number> = {}
  for (const criterion of criteria) {
    weights[criterion.id] = criterion.weight / total
  }
  return weights
}

function clampSignal(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

/**
 * internal_v1 score: the weighted mean of clamped signal strengths. Signal
 * sources are noisy, so out-of-range or missing values clamp to 0 rather than
 * poisoning the mean — a modeling decision, not error handling.
 */
export function scoreLead(signals: LeadSignals, tuning: ScoringTuning): number {
  let weighted = 0
  let totalWeight = 0
  for (const [criterionId, weight] of Object.entries(tuning)) {
    weighted += weight * clampSignal(signals[criterionId])
    totalWeight += weight
  }
  return totalWeight > 0 ? weighted / totalWeight : 0
}

/** First tier whose bounds contain the score (A checked first); below every bound is unqualified. */
export function tierForScore(
  score: number,
  tiers: { readonly A: TierBound; readonly B: TierBound; readonly C: TierBound },
): LeadTier {
  for (const tier of ['A', 'B', 'C'] as const) {
    const bound = tiers[tier]
    const min = bound.min ?? 0
    const max = bound.max ?? Number.POSITIVE_INFINITY
    if (score >= min && score <= max) {
      return tier
    }
  }
  return 'unqualified'
}

/** The top contributing criteria — the human-readable "why" behind a score. */
export function scoreRationale(signals: LeadSignals, tuning: ScoringTuning, topN = 2): string {
  const matched = Object.entries(tuning)
    .map(([criterionId, weight]) => ({
      criterionId,
      contribution: weight * clampSignal(signals[criterionId]),
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, topN)
    .filter((entry) => entry.contribution > 0)
    .map((entry) => entry.criterionId)
  return matched.length > 0 ? `matched on ${matched.join(', ')}` : 'no matching signals'
}
