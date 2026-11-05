/**
 * ScanEngineInterface — the swappable purchase-signal scan layer (spec locked
 * decision 3). Obvious is the primary research engine; Deepline is the
 * configured fallback. The engine swap point is configuration, never agent
 * code. Visible API and general-purpose crawlers (Apify, Tinyfish) are
 * deliberately out of this set.
 *
 * Layout:
 * - methodology — pure scan core: normalization, dedupe keys, segmentation,
 *   rolling windows, diagnostics (shared by every engine)
 * - engine-core — the one engine factory around an injected transport
 * - obvious / deepline — the two engines; transport = the network seam
 * - failover — composition: fallback, alerts, circuit breaker
 * - compiled — readers for the D3c-compiled workflow YAML (config, not intake)
 */

export * from './methodology.js'
export * from './engine-core.js'
export { createObviousScanEngine, type ObviousResearchRequest, type ObviousResearchTransport } from './obvious.js'
export {
  createDeeplineScanEngine,
  createDeeplineHttpTransport,
  mapDeeplineResponse,
  mapDeeplineFinding,
  DeeplineResponseError,
  type DeeplineResearchRequest,
  type DeeplineTransport,
  type DeeplineHttpTransportOptions,
} from './deepline.js'
export { withFallback, ScanEngineCircuitOpenError } from './failover.js'
export type {
  FailoverAlert,
  FailoverAlertKind,
  FailoverOptions,
  ComposedScanEngine,
} from './failover.js'
export {
  scanEngineSelectionFromCompiled,
  scanChannelsFromCompiled,
  scanQueryFromCompiled,
  segmentRulesFromCompiled,
  CompiledConfigError,
  type CompiledConfig,
  type CompiledEngineSelection,
} from './compiled.js'
