/**
 * Failover composition — the runtime guarantee behind locked decision 3:
 * Obvious primary, Deepline fallback, and never silent empty results.
 * Primary down → serve from the fallback. Both down → combined error, alert,
 * and after repeated double-failures a circuit opens so the platform gets a
 * cooldown instead of hammering two dead engines on every schedule tick.
 */

import { type ScanEngine, type ScanEngineId, type ScanEngineWithDiagnostics, type ScanQuery, type ScanRunResult, type ScanSignal } from './methodology.js'
import { synthesizeDiagnostics } from './engine-core.js'

/** Fired on both-engine failures and on circuit transitions — alert sinks are wired per deployment. */
export type FailoverAlertKind = 'both_engines_failed' | 'circuit_opened' | 'circuit_recovered'

export interface FailoverAlert {
  readonly kind: FailoverAlertKind
  readonly primary: ScanEngineId
  readonly fallback: ScanEngineId
  readonly error: string
  readonly at: string
  readonly consecutiveBothFailures: number
}

export interface FailoverOptions {
  readonly alert?: (alert: FailoverAlert) => void
  /** Both-engine failures before the circuit opens. Default 3. */
  readonly failureThreshold?: number
  /** How long an open circuit stops scans before the next probe. Default 5 minutes. */
  readonly cooldownMs?: number
  /** Injected clock for deterministic tests; defaults to the system clock. */
  readonly now?: () => number
}

/** Thrown while the circuit is open — carries when the next probe is due. */
export class ScanEngineCircuitOpenError extends Error {
  readonly reopenAt: string
  readonly consecutiveBothFailures: number

  constructor(message: string, options: { readonly reopenAt: string; readonly consecutiveBothFailures: number }) {
    super(message)
    this.name = 'ScanEngineCircuitOpenError'
    this.reopenAt = options.reopenAt
    this.consecutiveBothFailures = options.consecutiveBothFailures
  }
}

export interface ComposedScanEngine extends ScanEngineWithDiagnostics {
  readonly primary: ScanEngineId
  readonly fallback: ScanEngineId
}

/** Both-engine failures before the circuit opens (default 3). */
const FAILURE_THRESHOLD = 3
/** How long an open circuit stops scans before the next probe (default 5 minutes). */
const COOLDOWN_MS = 5 * 60 * 1000

type MaybeDiagnosticsEngine = ScanEngine & {
  readonly scanWithDiagnostics?: (query: ScanQuery) => Promise<ScanRunResult>
}

/** Engines that carry native diagnostics serve themselves; plain engines get synthesized diagnostics. */
async function serveWithDiagnostics(engine: ScanEngine, query: ScanQuery): Promise<ScanRunResult> {
  const native = (engine as MaybeDiagnosticsEngine).scanWithDiagnostics
  if (typeof native === 'function') {
    const result = await native.call(engine, query)
    return { ...result, servedBy: engine.id }
  }
  const signals: readonly ScanSignal[] = await engine.scan(query)
  return { servedBy: engine.id, signals, diagnostics: synthesizeDiagnostics(engine.id, signals) }
}

/**
 * Returns an engine that serves from `primary` and falls back to `fallback`
 * when the primary fails. If both engines fail, the combined error is thrown —
 * engine failures are never swallowed and empty results are never synthesized.
 * The composed engine keeps the diagnostics of whichever engine served.
 */
export function withFallback(primary: ScanEngine, fallback: ScanEngine, options: FailoverOptions = {}): ComposedScanEngine {
  if (primary.id === fallback.id) {
    throw new Error(`failover requires two different engines — primary and fallback are both '${primary.id}'`)
  }
  const alert = options.alert
  const now = options.now ?? Date.now
  const failureThreshold = options.failureThreshold ?? FAILURE_THRESHOLD
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS

  let consecutiveBothFailures = 0
  let openUntil = 0

  /** Any successful serve closes the circuit and resets the failure streak. */
  const markRecovered = (via: ScanEngineId, nowMs: number): void => {
    if (consecutiveBothFailures > 0) {
      alert?.({
        kind: 'circuit_recovered',
        primary: primary.id,
        fallback: fallback.id,
        error: `scan recovered via ${via} after ${consecutiveBothFailures} consecutive both-engine failures`,
        at: new Date(nowMs).toISOString(),
        consecutiveBothFailures: 0,
      })
    }
    consecutiveBothFailures = 0
    openUntil = 0
  }

  const serve = async (query: ScanQuery): Promise<ScanRunResult> => {
    const nowMs = now()
    if (nowMs < openUntil) {
      throw new ScanEngineCircuitOpenError(
        `scan-engine circuit open after ${consecutiveBothFailures} consecutive both-engine failures — next probe at ${new Date(openUntil).toISOString()}`,
        { reopenAt: new Date(openUntil).toISOString(), consecutiveBothFailures },
      )
    }
    try {
      const result = await serveWithDiagnostics(primary, query)
      markRecovered(primary.id, nowMs)
      return result
    } catch (primaryError) {
      try {
        const result = await serveWithDiagnostics(fallback, query)
        markRecovered(fallback.id, nowMs)
        return result
      } catch (fallbackError) {
        const combined = `both scan engines failed — primary (${primary.id}): ${String(primaryError)}; fallback (${fallback.id}): ${String(fallbackError)}`
        consecutiveBothFailures += 1
        const failures = consecutiveBothFailures
        alert?.({
          kind: 'both_engines_failed',
          primary: primary.id,
          fallback: fallback.id,
          error: combined,
          at: new Date(nowMs).toISOString(),
          consecutiveBothFailures: failures,
        })
        if (failures >= failureThreshold) {
          openUntil = nowMs + cooldownMs
          alert?.({
            kind: 'circuit_opened',
            primary: primary.id,
            fallback: fallback.id,
            error: `scan-engine circuit opened for ${cooldownMs}ms after ${failures} consecutive both-engine failures`,
            at: new Date(nowMs).toISOString(),
            consecutiveBothFailures: failures,
          })
        }
        throw new Error(combined)
      }
    }
  }

  return {
    id: primary.id,
    primary: primary.id,
    fallback: fallback.id,
    // Copy out of the readonly run result — the plain engine contract returns a mutable array.
    scan: async (query) => [...(await serve(query)).signals],
    scanWithDiagnostics: serve,
  }
}
