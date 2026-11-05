import { describe, expect, it } from 'vitest'
import { parseWorkflowConfig } from '@bloom/svc-config'
import {
  CompiledConfigError,
  scanChannelsFromCompiled,
  scanEngineSelectionFromCompiled,
  scanQueryFromCompiled,
  withFallback,
  type RawSignalRecord,
  type ScanEngineId,
  type ScanEngineWithDiagnostics,
  type ScanQuery,
} from '@bloom/adapter-scan-engine'
import { compileReferenceWorkflowYaml, flipEngineSelection, trackTransport, type TrackedEngine } from './helpers'

/**
 * THE spec acceptance test for the scan layer (locked decision 3): flipping
 * `engine.primary` in the COMPILED workflow YAML changes the scan path with
 * zero code edits. The composition is rebuilt purely from what the compiled
 * config says — the same registry of real (transport-seamed) engines serves
 * both sides of the flip.
 */

function fixtureRecords(): RawSignalRecord[] {
  return [
    {
      sourcePlatform: 'Wholesale Portal',
      signalType: 'purchase_request',
      title: 'Nordic retail chain sourcing exhibition stands',
      url: 'https://buyer.example/rfq/1',
      observedAt: '2026-10-20T00:00:00Z',
      organization: 'Nordic Retail Group AB',
    },
    {
      sourcePlatform: 'Trade Show Directory',
      signalType: 'expansion_signal',
      title: 'Nordic Retail Group exhibiting at EuroShop 2027',
      url: 'https://directory.example/euroshop',
      observedAt: '2026-10-25T00:00:00Z',
      organization: 'Nordic Retail Group AB',
    },
  ]
}

function buildRegistry(
  records: readonly RawSignalRecord[],
  options: { obviousFails?: boolean; deeplineFails?: boolean } = {},
): Record<ScanEngineId, ScanEngineWithDiagnostics> & { tracked: { obvious: TrackedEngine; deepline: TrackedEngine } } {
  const obvious = trackTransport('obvious', options.obviousFails ? new Error('obvious platform run failed') : records)
  const deepline = trackTransport('deepline', options.deeplineFails ? new Error('deepline run failed') : records)
  return { obvious: obvious.engine, deepline: deepline.engine, tracked: { obvious, deepline } }
}

/** The ONLY decision the code makes: read the compiled YAML, wire what it says. */
function composeFromCompiled(
  compiledYaml: string,
  registry: Record<ScanEngineId, ScanEngineWithDiagnostics>,
): ScanEngineWithDiagnostics {
  const selection = scanEngineSelectionFromCompiled(parseWorkflowConfig(compiledYaml))
  const primary = registry[selection.primary]
  const fallback = registry[selection.fallback]
  if (!primary || !fallback) {
    throw new Error(`compiled config names an unregistered engine: ${JSON.stringify(selection)}`)
  }
  return withFallback(primary, fallback)
}

describe('engine swap through the compiled workflow YAML', () => {
  it('serves from the compiled primary — Obvious — with the query traced to config', async () => {
    const yaml = compileReferenceWorkflowYaml()
    const compiled = parseWorkflowConfig(yaml)
    const query = scanQueryFromCompiled(compiled)
    const channels = scanChannelsFromCompiled(compiled)
    const registry = buildRegistry(fixtureRecords())

    const run = await composeFromCompiled(yaml, registry).scanWithDiagnostics(query)

    expect(scanEngineSelectionFromCompiled(compiled)).toEqual({ primary: 'obvious', fallback: 'deepline' })
    expect(run.servedBy).toBe('obvious')
    expect(registry.tracked.obvious.transportCalls()).toBe(1)
    expect(registry.tracked.deepline.transportCalls()).toBe(0)
    // the scan input is the compiled config's own channels/keywords/regions — not code constants
    expect(registry.tracked.obvious.lastRequest()?.channels).toEqual(channels)
    expect(registry.tracked.obvious.lastRequest()?.query.keywords).toEqual(query.keywords)
    expect(query.keywords.length).toBeGreaterThan(0)
    expect(query.regions.length).toBeGreaterThan(0)
    expect(run.signals.length).toBe(2)
  })

  it('flips the scan path when the compiled YAML flips — zero code edits', async () => {
    const yaml = flipEngineSelection(compileReferenceWorkflowYaml())
    const registry = buildRegistry(fixtureRecords())

    const run = await composeFromCompiled(yaml, registry).scanWithDiagnostics(scanQueryFromCompiled(parseWorkflowConfig(yaml)))

    expect(run.servedBy).toBe('deepline')
    expect(registry.tracked.deepline.transportCalls()).toBe(1)
    expect(registry.tracked.obvious.transportCalls()).toBe(0)
    expect(run.signals.every((signal) => signal.source === 'deepline')).toBe(true)
  })

  it('rejects a compiled config that names an engine outside the swappable set', () => {
    const yaml = compileReferenceWorkflowYaml().replace('primary: obvious', "primary: 'apify'")
    const registry = buildRegistry(fixtureRecords())
    expect(() => composeFromCompiled(yaml, registry)).toThrow(CompiledConfigError)
    expect(() => composeFromCompiled(yaml, registry)).toThrow(/one of: obvious, deepline/)
  })
})

describe('schema conformance of composed-run output', () => {
  it('every composed signal carries the core schema plus methodology fields', async () => {
    const yaml = compileReferenceWorkflowYaml()
    const registry = buildRegistry(fixtureRecords())
    const query: ScanQuery = scanQueryFromCompiled(parseWorkflowConfig(yaml))

    const run = await composeFromCompiled(yaml, registry).scanWithDiagnostics(query)

    expect(run.signals.length).toBeGreaterThan(0)
    for (const signal of run.signals) {
      expect(signal.title.length).toBeGreaterThan(0)
      expect(signal.url).toMatch(/^https?:\/\//)
      expect(['obvious', 'deepline']).toContain(signal.source)
      expect(signal.dedupeKey).toMatch(/^[^|]+\|[^|]+\|[^|]+$/)
      expect(signal.accountKey).toBe('nordic-retail-group') // organization slug, stable across both sources
      expect(signal.signalType).toBeDefined()
      expect(Number.isNaN(Date.parse(signal.observedAt ?? ''))).toBe(false)
      expect(signal.lagDays).toBeGreaterThanOrEqual(0)
      expect(signal.segment).toBeUndefined() // no segment rules in the reference config
    }
    // cross-source purchaser identity: one account key, two source platforms
    expect(new Set(run.signals.map((signal) => signal.sourcePlatform))).toEqual(new Set(['wholesale-portal', 'trade-show-directory']))
  })
})
