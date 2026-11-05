import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_DAYS,
  MalformedSignalRecordError,
  assignSegment,
  dedupeSignals,
  finalizeScanRun,
  normalizeSignalRecord,
  rollingWindowMetrics,
  signalAccountKey,
  slugifyOrganization,
  type RawSignalRecord,
  type SegmentRule,
} from './methodology'

const NOW_MS = Date.parse('2026-11-05T00:00:00Z')

function rawRecord(overrides: Partial<RawSignalRecord> = {}): RawSignalRecord {
  return {
    sourcePlatform: 'display-wholesale-portal',
    signalType: 'purchase_request',
    title: 'Supermarket chain sourcing shelf display racks',
    url: 'https://buyer.example/sourcing/shelving',
    observedAt: '2026-10-20T00:00:00Z',
    organization: 'Acme Trading Co Ltd',
    ...overrides,
  }
}

const SEGMENT_RULES: readonly SegmentRule[] = [
  { segment: 'retail-display-fixtures', evidenceTerms: ['shelving', 'display rack'] },
  { segment: 'material-handling', evidenceTerms: ['pallet racking', 'forklift'] },
]

describe('account identity and dedupe keys', () => {
  it('prefers the source-native account key over the organization slug', () => {
    const record = rawRecord({ accountKey: 'BUYER-ACME-01' })
    expect(signalAccountKey(record)).toBe('buyer-acme-01')
  })

  it('slugifies the organization and strips trailing legal suffixes repeatedly', () => {
    expect(slugifyOrganization('Acme Trading Co Ltd')).toBe('acme-trading')
    expect(signalAccountKey(rawRecord())).toBe('acme-trading')
  })

  it('throws naming the rule when a record has no purchaser-side identity', () => {
    expect(() => signalAccountKey(rawRecord({ organization: undefined }))).toThrow(MalformedSignalRecordError)
    expect(() => signalAccountKey(rawRecord({ organization: undefined }))).toThrow(/must never key a signal/)
  })

  it('never re-keys on seller attribution flips or listing-title edits', () => {
    const original = normalizeSignalRecord(rawRecord({ sellerAttribution: 'TradeHub Agency' }), { engineId: 'obvious', nowMs: NOW_MS })
    const flippedSeller = normalizeSignalRecord(
      rawRecord({ sellerAttribution: 'Some Other Agency GmbH', title: 'Completely edited listing title' }),
      { engineId: 'obvious', nowMs: NOW_MS },
    )
    expect(flippedSeller.dedupeKey).toBe(original.dedupeKey)
    expect(original.dedupeKey).toBe('display-wholesale-portal|purchase_request|acme-trading')
  })

  it('keys differently across organizations, signal types, and source platforms', () => {
    const base = normalizeSignalRecord(rawRecord(), { engineId: 'obvious', nowMs: NOW_MS })
    const otherOrg = normalizeSignalRecord(rawRecord({ organization: 'Beta Retail Group' }), { engineId: 'obvious', nowMs: NOW_MS })
    const otherType = normalizeSignalRecord(rawRecord({ signalType: 'listing' }), { engineId: 'obvious', nowMs: NOW_MS })
    const otherSource = normalizeSignalRecord(rawRecord({ sourcePlatform: 'Tender Portal' }), { engineId: 'obvious', nowMs: NOW_MS })
    expect(otherOrg.dedupeKey).not.toBe(base.dedupeKey)
    expect(otherType.dedupeKey).not.toBe(base.dedupeKey)
    expect(otherSource.dedupeKey).not.toBe(base.dedupeKey)
    // sourcePlatform is normalized so case drift cannot re-key either
    expect(otherSource.dedupeKey.startsWith('tender-portal|')).toBe(true)
  })
})

describe('segment assignment', () => {
  it('assigns a segment only on equipment evidence in the row itself', () => {
    const record = rawRecord({ evidence: 'Procurement lead confirms shelving budget for 40 stores' })
    expect(assignSegment(record, SEGMENT_RULES)).toBe('retail-display-fixtures')
  })

  it('never assigns a segment from a query keyword that is not in the row', () => {
    const record = rawRecord({ title: 'Expanding into Germany next year' })
    expect(assignSegment(record, SEGMENT_RULES)).toBeUndefined()
  })

  it('matches hyphenated and multi-word evidence terms', () => {
    expect(assignSegment(rawRecord({ title: 'Buyer evaluating pallet-racking suppliers' }), SEGMENT_RULES)).toBe('material-handling')
  })
})

describe('normalizeSignalRecord', () => {
  it('carries lag and expected lag as properties', () => {
    const normalized = normalizeSignalRecord(
      rawRecord({ observedAt: '2026-09-01T00:00:00Z', expectedLagDays: 30 }),
      { engineId: 'deepline', nowMs: NOW_MS },
    )
    expect(normalized.lagDays).toBe(65)
    expect(normalized.lagExceedsExpected).toBe(true)
    expect(normalized.expectedLagDays).toBe(30)
    expect(normalized.source).toBe('deepline')
  })

  it('never reports negative lag for future-dated records', () => {
    const normalized = normalizeSignalRecord(rawRecord({ observedAt: '2026-12-01T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    expect(normalized.lagDays).toBe(0)
  })

  it('throws naming every malformed field — records are fixed at the transport, never dropped', () => {
    const bad = rawRecord({ title: '', url: 'not-a-url', observedAt: 'yesterday' }) as RawSignalRecord & { organization?: string }
    delete bad.organization
    let message = ''
    try {
      normalizeSignalRecord(bad, { engineId: 'obvious', nowMs: NOW_MS })
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toContain('title')
    expect(message).toContain('url')
    expect(message).toContain('observedAt')
    expect(message).toContain('account identity')
  })
})

describe('dedupeSignals', () => {
  it('keeps the newest sighting of a key and orders newest first', () => {
    const older = normalizeSignalRecord(rawRecord({ observedAt: '2026-10-01T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const newer = normalizeSignalRecord(rawRecord({ observedAt: '2026-10-15T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const outcome = dedupeSignals([older, newer])
    expect(outcome.kept).toHaveLength(1)
    expect(outcome.kept[0]?.observedAt).toBe('2026-10-15T00:00:00Z')
    expect(outcome.suppressed).toBe(1)
    expect(outcome.knownSkipped).toBe(0)
  })

  it('drops re-encounters of keys already in persistent state', () => {
    const signal = normalizeSignalRecord(rawRecord(), { engineId: 'obvious', nowMs: NOW_MS })
    const fresh = normalizeSignalRecord(rawRecord({ organization: 'Beta Retail Group' }), { engineId: 'obvious', nowMs: NOW_MS })
    const outcome = dedupeSignals([signal, fresh], new Set([signal.dedupeKey]))
    expect(outcome.kept).toHaveLength(1)
    expect(outcome.knownSkipped).toBe(1)
  })
})

describe('rollingWindowMetrics', () => {
  it('counts only the rolling window; full history never drags the aggregates', () => {
    const within = normalizeSignalRecord(rawRecord({ observedAt: '2026-10-20T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const stale = normalizeSignalRecord(rawRecord({ observedAt: '2026-06-01T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const metrics = rollingWindowMetrics([within, stale], { nowMs: NOW_MS })
    expect(metrics.windowDays).toBe(DEFAULT_WINDOW_DAYS)
    expect(metrics.withinWindow).toBe(1)
    expect(metrics.outsideWindow).toBe(1)
    expect(metrics.bySignalType['purchase_request']).toBe(1)
    expect(metrics.bySegment).toEqual({})
  })
})

describe('finalizeScanRun', () => {
  it('caps output newest-first and reports per-source stats', () => {
    const a = normalizeSignalRecord(rawRecord({ organization: 'Alpha Retail', observedAt: '2026-10-01T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const b = normalizeSignalRecord(rawRecord({ organization: 'Beta Retail', observedAt: '2026-10-10T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const c = normalizeSignalRecord(rawRecord({ organization: 'Gamma Retail', observedAt: '2026-10-20T00:00:00Z' }), { engineId: 'obvious', nowMs: NOW_MS })
    const run = finalizeScanRun([a, b, c], {
      engineId: 'obvious',
      channels: ['web'],
      query: { keywords: ['display'], regions: ['EU'], maxResults: 2 },
      nowMs: NOW_MS,
    })
    expect(run.servedBy).toBe('obvious')
    expect(run.signals).toHaveLength(2)
    expect(run.signals[0]?.title).toBe(c.title)
    expect(run.diagnostics.signalsOut).toBe(2)
    expect(run.diagnostics.perSource['display-wholesale-portal']?.records).toBe(3)
    expect(run.diagnostics.perSource['display-wholesale-portal']?.emitted).toBe(2)
  })

  it('reports a zero-yield run as a finding, not a failure', () => {
    const run = finalizeScanRun([], {
      engineId: 'deepline',
      channels: ['news'],
      query: { keywords: ['rare keyword'], regions: ['US'] },
      nowMs: NOW_MS,
    })
    expect(run.signals).toEqual([])
    expect(run.diagnostics.findings.some((finding) => finding.includes('zero signals'))).toBe(true)
  })

  it('reports source lag exceeding expectations as a property, not breakage', () => {
    const stale = normalizeSignalRecord(
      rawRecord({ sourcePlatform: 'autender', observedAt: '2026-08-01T00:00:00Z', expectedLagDays: 30 }),
      { engineId: 'obvious', nowMs: NOW_MS },
    )
    const run = finalizeScanRun([stale], {
      engineId: 'obvious',
      channels: ['tenders'],
      query: { keywords: ['shelving'], regions: ['AU'] },
      nowMs: NOW_MS,
    })
    expect(run.signals).toHaveLength(1) // still delivered — lag is a property
    expect(run.diagnostics.findings.some((finding) => finding.includes(`source 'autender'`) && finding.includes('not breakage'))).toBe(true)
  })
})
