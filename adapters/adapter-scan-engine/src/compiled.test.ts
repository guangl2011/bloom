import { describe, expect, it } from 'vitest'
import {
  CompiledConfigError,
  scanChannelsFromCompiled,
  scanEngineSelectionFromCompiled,
  scanQueryFromCompiled,
  segmentRulesFromCompiled,
  type CompiledConfig,
} from './compiled'

function compiledConfig(overrides: Record<string, unknown> = {}): CompiledConfig {
  return {
    workflow: {
      purchase_signals: {
        channels: ['web', 'news', 'tenders', 'trade-shows'],
        query_terms: { monitor: ['display rack', 'shelving'] },
        scope: { regions: ['EU', 'AU'] },
        max_signals_per_period: 50,
        engine: { primary: 'obvious', fallback: 'deepline' },
        ...overrides,
      },
    },
  }
}

describe('scanEngineSelectionFromCompiled', () => {
  it('reads the engine envelope', () => {
    expect(scanEngineSelectionFromCompiled(compiledConfig())).toEqual({ primary: 'obvious', fallback: 'deepline' })
  })

  it('flips when the compiled YAML flips — the swap point is config', () => {
    const flipped = compiledConfig()
    const signals = (flipped['workflow'] as Record<string, unknown>)['purchase_signals'] as Record<string, unknown>
    signals['engine'] = { primary: 'deepline', fallback: 'obvious' }
    expect(scanEngineSelectionFromCompiled(flipped)).toEqual({ primary: 'deepline', fallback: 'obvious' })
  })

  it('rejects unknown engines, missing blocks, and same-engine failover', () => {
    expect(() => scanEngineSelectionFromCompiled(compiledConfig({ engine: { primary: 'apify', fallback: 'deepline' } }))).toThrow(CompiledConfigError)
    expect(() => scanEngineSelectionFromCompiled({})).toThrow(CompiledConfigError)
    expect(() => scanEngineSelectionFromCompiled(compiledConfig({ engine: { primary: 'obvious', fallback: 'obvious' } }))).toThrow(/config defect/)
  })
})

describe('scanChannelsFromCompiled', () => {
  it('normalizes and validates channels from the compiled block', () => {
    expect(scanChannelsFromCompiled(compiledConfig())).toEqual(['web', 'news', 'tenders', 'trade-shows'])
    expect(() => scanChannelsFromCompiled(compiledConfig({ channels: ['linkedin-crawler'] }))).toThrow(/valid channels/)
    expect(() => scanChannelsFromCompiled(compiledConfig({ channels: 'web' }))).toThrow(CompiledConfigError)
  })
})

describe('scanQueryFromCompiled', () => {
  it('carries keywords, regions, and the per-period cap from config', () => {
    const query = scanQueryFromCompiled(compiledConfig())
    expect(query.keywords).toEqual(['display rack', 'shelving'])
    expect(query.regions).toEqual(['EU', 'AU'])
    expect(query.maxResults).toBe(50)
  })

  it('rejects malformed query terms and non-integer caps', () => {
    expect(() => scanQueryFromCompiled(compiledConfig({ query_terms: {} }))).toThrow(/monitor/)
    expect(() => scanQueryFromCompiled(compiledConfig({ max_signals_per_period: 1.5 }))).toThrow(/max_signals_per_period/)
  })
})

describe('segmentRulesFromCompiled', () => {
  it('passes through valid rules and defaults to empty when absent', () => {
    const withRules = compiledConfig({
      segments: [{ segment: 'retail-fixtures', evidenceTerms: ['shelving'] }],
    })
    expect(segmentRulesFromCompiled(withRules)).toEqual([{ segment: 'retail-fixtures', evidenceTerms: ['shelving'] }])
    expect(segmentRulesFromCompiled(compiledConfig())).toEqual([])
  })

  it('rejects rules without segment names or evidence terms', () => {
    expect(() => segmentRulesFromCompiled(compiledConfig({ segments: [{ segment: 'x', evidenceTerms: [] }] }))).toThrow(/evidenceTerms/)
  })
})
