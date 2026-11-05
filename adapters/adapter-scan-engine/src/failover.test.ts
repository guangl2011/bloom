import { describe, expect, it } from 'vitest'
import { ScanEngineCircuitOpenError, withFallback, type FailoverAlert } from './failover'
import type { ScanEngine, ScanEngineId, ScanQuery, ScanSignal } from './methodology'

const QUERY: ScanQuery = { keywords: ['shelving'], regions: ['EU'] }

function stubEngine(
  id: ScanEngineId,
  behavior: 'ok' | 'fail',
  signals: readonly ScanSignal[] = [{ title: 'A', url: 'https://example.com/a', source: id }],
): ScanEngine & { calls: () => number } {
  let calls = 0
  return {
    id,
    calls: () => calls,
    async scan() {
      calls += 1
      if (behavior === 'fail') {
        throw new Error(`${id} transport down`)
      }
      return [...signals]
    },
  }
}

function manualClock() {
  let ms = Date.parse('2026-11-05T00:00:00Z')
  return {
    now: () => ms,
    advance: (deltaMs: number) => {
      ms += deltaMs
    },
  }
}

describe('withFallback — serving', () => {
  it('serves from the primary when healthy; fallback never called', async () => {
    const primary = stubEngine('obvious', 'ok')
    const fallback = stubEngine('deepline', 'ok')
    const composed = withFallback(primary, fallback)
    const run = await composed.scanWithDiagnostics(QUERY)
    expect(run.servedBy).toBe('obvious')
    expect(run.signals).toHaveLength(1)
    expect(primary.calls()).toBe(1)
    expect(fallback.calls()).toBe(0)
  })

  it('falls back when the primary fails — never a silent empty result', async () => {
    const primary = stubEngine('obvious', 'fail')
    const fallback = stubEngine('deepline', 'ok')
    const composed = withFallback(primary, fallback)
    const run = await composed.scanWithDiagnostics(QUERY)
    expect(run.servedBy).toBe('deepline')
    expect(run.diagnostics.engineId).toBe('deepline')
    expect(primary.calls()).toBe(1)
    expect(fallback.calls()).toBe(1)
  })

  it('synthesizes diagnostics for a plain-engine fallback and keeps its servedBy', async () => {
    const plainFallback: ScanEngine = { id: 'deepline', scan: async () => [{ title: 'B', url: 'https://example.com/b', source: 'deepline' }] }
    const composed = withFallback(stubEngine('obvious', 'fail'), plainFallback)
    const run = await composed.scanWithDiagnostics(QUERY)
    expect(run.servedBy).toBe('deepline')
    expect(run.diagnostics.engineId).toBe('deepline')
    expect(run.diagnostics.signalsOut).toBe(1)
    // synthesized runs carry no windowed aggregates rather than invented ones
    expect(run.diagnostics.rollingWindow.withinWindow).toBe(0)
  })

  it('throws a combined error naming both engines when both fail', async () => {
    const primary = stubEngine('obvious', 'fail')
    const fallback = stubEngine('deepline', 'fail')
    const composed = withFallback(primary, fallback)
    const error = await composed.scan(QUERY).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('primary (obvious)')
    expect((error as Error).message).toContain('fallback (deepline)')
  })

  it('refuses same-engine failover at composition time', () => {
    expect(() => withFallback(stubEngine('obvious', 'ok'), stubEngine('obvious', 'ok'))).toThrow(/two different engines/)
  })
})

describe('withFallback — alerts and circuit breaker', () => {
  it('alerts on both-engine failures and on recovery, not on fallback-saved runs', async () => {
    const alerts: FailoverAlert[] = []
    const clock = manualClock()
    let primaryHealthy = false
    let fallbackHealthy = true
    const primary = stubEngine('obvious', 'fail')
    primary.scan = async () => {
      if (!primaryHealthy) {
        throw new Error('obvious down')
      }
      return [{ title: 'A', url: 'https://example.com/a', source: 'obvious' }]
    }
    const fallback = stubEngine('deepline', 'ok')
    fallback.scan = async () => {
      if (!fallbackHealthy) {
        throw new Error('deepline down')
      }
      return [{ title: 'B', url: 'https://example.com/b', source: 'deepline' }]
    }
    const composed = withFallback(primary, fallback, { alert: (alert) => alerts.push(alert), now: clock.now })

    await composed.scan(QUERY)
    expect(alerts).toHaveLength(0) // fallback saved the run — no page

    fallbackHealthy = false
    await expect(composed.scan(QUERY)).rejects.toThrow(/primary \(obvious\)/)
    expect(alerts.map((alert) => alert.kind)).toEqual(['both_engines_failed'])

    primaryHealthy = true
    const run = await composed.scanWithDiagnostics(QUERY)
    expect(run.servedBy).toBe('obvious')
    expect(alerts.map((alert) => alert.kind)).toEqual(['both_engines_failed', 'circuit_recovered'])
    expect(alerts[1]?.error).toContain('recovered via obvious')
  })

  it('opens the circuit after repeated both-engine failures and stops calling the engines', async () => {
    const alerts: FailoverAlert[] = []
    const clock = manualClock()
    const primary = stubEngine('obvious', 'fail')
    const fallback = stubEngine('deepline', 'fail')
    const composed = withFallback(primary, fallback, {
      alert: (alert) => alerts.push(alert),
      now: clock.now,
      failureThreshold: 3,
      cooldownMs: 5 * 60 * 1000,
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(composed.scan(QUERY)).rejects.toThrow(/primary \(obvious\)/)
    }
    // three both-engine failure alerts, then the circuit-opened alert on the third
    expect(alerts.map((alert) => alert.kind)).toEqual([
      'both_engines_failed',
      'both_engines_failed',
      'both_engines_failed',
      'circuit_opened',
    ])
    expect(alerts[2]?.consecutiveBothFailures).toBe(3)

    const callsBefore = primary.calls() + fallback.calls()
    const error = await composed.scan(QUERY).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ScanEngineCircuitOpenError)
    expect((error as ScanEngineCircuitOpenError).reopenAt).toBe(new Date(clock.now() + 5 * 60 * 1000).toISOString())
    expect(primary.calls() + fallback.calls()).toBe(callsBefore) // circuit short-circuits before any engine call
  })

  it('probes again after the cooldown expires and recovers through the same composition', async () => {
    const clock = manualClock()
    let primaryHealthy = false
    const primary = stubEngine('obvious', 'fail')
    primary.scan = async () => {
      if (!primaryHealthy) {
        throw new Error('obvious down')
      }
      return [{ title: 'A', url: 'https://example.com/a', source: 'obvious' }]
    }
    const fallback = stubEngine('deepline', 'fail')
    const composed = withFallback(primary, fallback, { now: clock.now, failureThreshold: 3, cooldownMs: 60 * 1000 })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(composed.scan(QUERY)).rejects.toThrow()
    }
    await expect(composed.scan(QUERY)).rejects.toBeInstanceOf(ScanEngineCircuitOpenError)

    clock.advance(60 * 1000 + 1)
    // probe goes through while both engines are still down — the combined error re-opens the circuit
    await expect(composed.scan(QUERY)).rejects.toThrow(/primary \(obvious\)/)

    clock.advance(60 * 1000 + 1)
    primaryHealthy = true
    const run = await composed.scanWithDiagnostics(QUERY)
    expect(run.servedBy).toBe('obvious')
  })
})
