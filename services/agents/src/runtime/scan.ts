import { withFallback, type FailoverOptions } from '@bloom/adapter-scan-engine'
import type { ScanEngineId, ScanEngineInterface, WorkflowConfig } from '@bloom/interfaces'

/** Registered scan engines by id; selection is driven entirely by config. */
export type ScanEngineRegistry = Readonly<Record<ScanEngineId, ScanEngineInterface>>

/**
 * Composes the configured engine chain — Obvious primary, Deepline fallback in
 * the reference config (spec locked decision 3). Flipping `engine.primary` or
 * `engine.fallback` in the workflow config changes the scan path with zero
 * agent-code edits; unregistered engines fail fast here, not mid-scan.
 * Failover options (alerts, circuit thresholds) pass straight through to the
 * composition — deployments wire alert sinks, agents never see failover.
 */
export function composeScanEngine(
  config: WorkflowConfig,
  registry: ScanEngineRegistry,
  failoverOptions?: FailoverOptions,
): ScanEngineInterface {
  const { primary, fallback } = config.purchaseSignals.engine
  const primaryEngine = registry[primary]
  if (!primaryEngine) {
    throw new Error(`primary scan engine '${primary}' is not registered`)
  }
  const fallbackEngine = registry[fallback]
  if (!fallbackEngine) {
    throw new Error(`fallback scan engine '${fallback}' is not registered`)
  }
  return withFallback(primaryEngine, fallbackEngine, failoverOptions)
}
