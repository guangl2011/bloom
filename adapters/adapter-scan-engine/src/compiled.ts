/**
 * Readers for the D3c-compiled workflow configuration — the ONLY config the
 * scan engines consume. The intake workbook compiles to versioned YAML in
 * services/config; these readers navigate the compiled object and fail loudly
 * on missing or invalid engine blocks. The adapters never re-parse intake.
 */

import { resolveChannels } from './engine-core.js'
import type { ScanChannel, ScanEngineId, ScanQuery } from './methodology.js'

export interface CompiledEngineSelection {
  readonly primary: ScanEngineId
  readonly fallback: ScanEngineId
}

/** Thrown when the compiled workflow YAML lacks a valid purchase-signals engine block. */
export class CompiledConfigError extends Error {}

export type CompiledConfig = Record<string, unknown>

const WORKFLOW = 'workflow'
const SIGNALS = 'purchase_signals'

function blockAt(root: CompiledConfig, path: readonly string[]): Record<string, unknown> {
  let current: unknown = root
  let traversed: string[] = []
  for (const key of path) {
    traversed = [...traversed, key]
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new CompiledConfigError(`compiled workflow config is missing '${traversed.join('.')}'`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new CompiledConfigError(`compiled workflow config is missing '${traversed.join('.')}'`)
  }
  return current as Record<string, unknown>
}

const ENGINE_IDS: readonly ScanEngineId[] = ['obvious', 'deepline']

/**
 * The engine selection for the purchase-signal workflow — `engine.primary`
 * and `engine.fallback` in the compiled YAML. Flipping these values flips the
 * scan path with zero code edits: the spec's core acceptance test.
 */
export function scanEngineSelectionFromCompiled(compiled: CompiledConfig): CompiledEngineSelection {
  const engine = blockAt(compiled, [WORKFLOW, SIGNALS, 'engine'])
  const primary = engine['primary']
  const fallback = engine['fallback']
  for (const [role, value] of [['primary', primary], ['fallback', fallback]] as const) {
    if (typeof value !== 'string' || !ENGINE_IDS.includes(value as ScanEngineId)) {
      throw new CompiledConfigError(`engine.${role} must be one of: ${ENGINE_IDS.join(', ')} — got '${String(value)}'`)
    }
  }
  if (primary === fallback) {
    throw new CompiledConfigError(
      `engine.primary and engine.fallback are both '${String(primary)}' — failover across one engine is a config defect`,
    )
  }
  return { primary: primary as ScanEngineId, fallback: fallback as ScanEngineId }
}

/** Channels to activate — from the purchase-signals block, normalized and validated. */
export function scanChannelsFromCompiled(compiled: CompiledConfig): readonly ScanChannel[] {
  const signals = blockAt(compiled, [WORKFLOW, SIGNALS])
  const channels = signals['channels']
  if (!Array.isArray(channels) || channels.some((channel) => typeof channel !== 'string')) {
    throw new CompiledConfigError('purchase_signals.channels must be a list of channel names')
  }
  return resolveChannels(channels as readonly ScanChannel[])
}

/**
 * The scan query — monitoring keywords, regions, and the per-period signal
 * cap straight from the compiled YAML. The adapter-level engine-swap test
 * drives engines with THIS query, so the whole scan input traces to config.
 */
export function scanQueryFromCompiled(compiled: CompiledConfig): ScanQuery {
  const signals = blockAt(compiled, [WORKFLOW, SIGNALS])
  const terms = blockAt(signals, ['query_terms'])
  const scope = blockAt(signals, ['scope'])
  const keywords = terms['monitor']
  const regions = scope['regions']
  if (!Array.isArray(keywords) || keywords.some((keyword) => typeof keyword !== 'string')) {
    throw new CompiledConfigError('purchase_signals.query_terms.monitor must be a list of keywords')
  }
  if (!Array.isArray(regions) || regions.some((region) => typeof region !== 'string')) {
    throw new CompiledConfigError('purchase_signals.scope.regions must be a list of regions')
  }
  const max = signals['max_signals_per_period']
  if (max !== undefined && (typeof max !== 'number' || !Number.isInteger(max) || max <= 0)) {
    throw new CompiledConfigError('purchase_signals.max_signals_per_period must be a positive integer')
  }
  return {
    keywords: keywords as readonly string[],
    regions: regions as readonly string[],
    ...(typeof max === 'number' ? { maxResults: max } : {}),
  }
}

/** Validates an optional per-customer segment rule list from the compiled config. */
export function segmentRulesFromCompiled(
  compiled: CompiledConfig,
): readonly { readonly segment: string; readonly evidenceTerms: readonly string[] }[] {
  const signals = blockAt(compiled, [WORKFLOW, SIGNALS])
  const rules = signals['segments']
  if (rules === undefined) {
    return []
  }
  if (!Array.isArray(rules)) {
    throw new CompiledConfigError('purchase_signals.segments must be a list of { segment, evidenceTerms }')
  }
  return rules.map((rule, index) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new CompiledConfigError(`purchase_signals.segments[${index}] must be an object`)
    }
    const record = rule as Record<string, unknown>
    if (typeof record['segment'] !== 'string' || record['segment'].trim().length === 0) {
      throw new CompiledConfigError(`purchase_signals.segments[${index}].segment must be a non-empty string`)
    }
    const terms = record['evidenceTerms']
    if (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string') || terms.length === 0) {
      throw new CompiledConfigError(
        `purchase_signals.segments[${index}].evidenceTerms must be a non-empty list of strings`,
      )
    }
    return { segment: record['segment'], evidenceTerms: terms as readonly string[] }
  })
}
