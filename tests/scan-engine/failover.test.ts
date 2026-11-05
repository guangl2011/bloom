import { describe, expect, it } from 'vitest'
import { parseWorkflowConfig } from '@bloom/svc-config'
import {
  scanEngineSelectionFromCompiled,
  scanQueryFromCompiled,
  withFallback,
  type FailoverAlert,
  type RawSignalRecord,
  type ScanEngineCircuitOpenError,
  type ScanEngineId,
  type ScanEngineWithDiagnostics,
} from '@bloom/adapter-scan-engine'
import { composeScanEngine, type ScanEngineRegistry } from '@bloom/svc-agents/src/runtime/scan'
import {
  compileReferenceWorkflowYaml,
  trackTransport,
  runtimeConfig,
  type TrackedEngine,
} from './helpers'

/**
 * Failover integration through the services/agents wiring seam: the same
 * composeScanEngine call production uses, over real (transport-seamed)
 * engines. Also proves dedupe-key stability across runs against persistent
 * state — the AU-build defect class (seller flips and title edits creating
 * duplicates) cannot recur through the composed chain.
 */

function records(seller: string): RawSignalRecord[] {
  return [
    {
      sourcePlatform: 'wholesale-portal',
      signalType: 'purchase_request',
      title: 'Nordic retail chain sourcing exhibition stands',
      url: 'https://buyer.example/rfq/1',
      observedAt: '2026-10-20T00:00:00Z',
      organization: 'Nordic Retail Group AB',
      sellerAttribution: seller,
    },
    {
      sourcePlatform: 'wholesale-portal',
      signalType: 'listing',
      title: 'Nordic Retail Group evaluating booth suppliers',
      url: 'https://buyer.example/listing/1',
      observedAt: '2026-10-21T00:00:00Z',
      organization: 'Nordic Retail Group AB',
      sellerAttribution: seller,
    },
  ]
}

function registryWith(
  options: { readonly obviousFails?: boolean; readonly deeplineFails?: boolean; readonly knownKeys?: Set<string> },
  runTwoRecords?: readonly RawSignalRecord[],
): {
  registry: ScanEngineRegistry
  engines: { readonly obvious: ScanEngineWithDiagnostics; readonly deepline: ScanEngineWithDiagnostics }
  tracked: { obvious: TrackedEngine; deepline: TrackedEngine }
} {
  const obvious = trackTransport('obvious', options.obviousFails ? new Error('obvious down') : (runTwoRecords ?? records('TradeHub Agency')), {
    knownKeys: options.knownKeys,
  })
  const deepline = trackTransport(
    'deepline',
    options.deeplineFails ? new Error('deepline down') : (runTwoRecords ?? records('TradeHub Agency')),
    { knownKeys: options.knownKeys },
  )
  return {
    registry: { obvious: obvious.engine, deepline: deepline.engine },
    engines: { obvious: obvious.engine, deepline: deepline.engine },
    tracked: { obvious, deepline },
  }
}

/** Adapter-level composition from the compiled selection — the diagnostics-bearing surface. */
function composeFromCompiledForDiagnostics(
  compiledYaml: string,
  engines: { readonly obvious: ScanEngineWithDiagnostics; readonly deepline: ScanEngineWithDiagnostics },
): ScanEngineWithDiagnostics {
  const selection = scanEngineSelectionFromCompiled(parseWorkflowConfig(compiledYaml))
  return withFallback(engines[selection.primary], engines[selection.fallback])
}

function configQuery(engine: { primary: ScanEngineId; fallback: ScanEngineId }) {
  return runtimeConfig(engine)
}

function queryFromYaml(yaml: string) {
  return scanQueryFromCompiled(parseWorkflowConfig(yaml))
}

describe('composeScanEngine — the runtime wiring seam', () => {
  it('fails fast naming the engine when the config names an unregistered engine', () => {
    expect(() => composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), {} as ScanEngineRegistry)).toThrow(
      /primary scan engine 'obvious' is not registered/,
    )
    const onlyObvious = registryWith({}).registry
    expect(() =>
      composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), { obvious: onlyObvious.obvious } as ScanEngineRegistry),
    ).toThrow(/fallback scan engine 'deepline' is not registered/)
  })

  it('serves from the fallback when the primary transport dies', async () => {
    const { registry, tracked } = registryWith({ obviousFails: true })
    const composed = composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), registry)
    const signals = await composed.scan(queryFromYaml(compileReferenceWorkflowYaml()))
    expect(signals.every((signal) => signal.source === 'deepline')).toBe(true)
    expect(tracked.obvious.transportCalls()).toBe(1)
    expect(tracked.deepline.transportCalls()).toBe(1)
  })

  it('passes failover options through: both engines down is a combined error plus an alert', async () => {
    const { registry } = registryWith({ obviousFails: true, deeplineFails: true })
    const alerts: FailoverAlert[] = []
    const composed = composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), registry, {
      alert: (alert) => alerts.push(alert),
    })
    await expect(composed.scan(queryFromYaml(compileReferenceWorkflowYaml()))).rejects.toThrow(/primary \(obvious\).*fallback \(deepline\)/s)
    expect(alerts.map((alert) => alert.kind)).toEqual(['both_engines_failed'])
  })

  it('opens the circuit through the wiring after repeated double failures, then recovers', async () => {
    let ms = Date.parse('2026-11-05T00:00:00Z')
    const clock = () => ms
    const failing = registryWith({ obviousFails: true, deeplineFails: true })
    const composed = composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), failing.registry, {
      now: clock,
      failureThreshold: 2,
      cooldownMs: 60_000,
    })
    const query = queryFromYaml(compileReferenceWorkflowYaml())

    await expect(composed.scan(query)).rejects.toThrow(/both scan engines failed/)
    await expect(composed.scan(query)).rejects.toThrow(/both scan engines failed/)
    const callsAtOpen = failing.tracked.obvious.transportCalls() + failing.tracked.deepline.transportCalls()

    const error = await composed.scan(query).catch((caught: unknown) => caught)
    expect((error as ScanEngineCircuitOpenError).name).toBe('ScanEngineCircuitOpenError')
    expect(failing.tracked.obvious.transportCalls() + failing.tracked.deepline.transportCalls()).toBe(callsAtOpen) // short-circuited

    // after the cooldown with healthy engines, the probe serves from the primary again
    ms += 60_000 + 1
    const healthy = registryWith({})
    const recovered = composeScanEngine(configQuery({ primary: 'obvious', fallback: 'deepline' }), healthy.registry, { now: clock })
    const signals = await recovered.scan(query)
    expect(signals.every((signal) => signal.source === 'obvious')).toBe(true)
  })
})

describe('dedupe-key stability across runs against persistent state', () => {
  it('seller-attribution flips and title edits never re-key — re-encounters are dropped', async () => {
    const persistentKeys = new Set<string>()
    const yaml = compileReferenceWorkflowYaml()
    const query = queryFromYaml(yaml)

    // Run 1: observe and persist.
    const first = registryWith({ knownKeys: persistentKeys })
    const runOne = await composeFromCompiledForDiagnostics(yaml, first.engines).scanWithDiagnostics(query)
    expect(runOne.signals).toHaveLength(2)
    for (const signal of runOne.signals) {
      expect(signal.dedupeKey).toBeDefined()
      persistentKeys.add(signal.dedupeKey as string)
    }

    // Run 2: same purchaser, flipped seller attribution, edited listing titles.
    const second = registryWith({ knownKeys: persistentKeys }, records('Completely Different Agency GmbH'))
    const runTwo = await composeFromCompiledForDiagnostics(yaml, second.engines).scanWithDiagnostics(query)
    expect(runTwo.signals).toHaveLength(0) // both re-encounters dropped — no duplicates created
    expect(runTwo.diagnostics.knownSkipped).toBe(2)
    // zero yield after dedupe is a finding, not a failure
    expect(runTwo.diagnostics.findings.some((finding) => finding.includes('zero signals'))).toBe(true)
  })
})
