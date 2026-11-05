import { describe, expect, it } from 'vitest'
import { aTierAccuracy, formatCredits, formatDuration, formatTimestamp, usageBreakdown } from './view-models'

describe('usageBreakdown', () => {
  it('groups records by tool:model and sorts by cost descending', () => {
    const rows = usageBreakdown([
      { tool: 'llm', model: 'haiku', units: 10, costCredits: 1.0 },
      { tool: 'llm', model: 'sonnet', units: 5, costCredits: 3.0 },
      { tool: 'llm', model: 'haiku', units: 20, costCredits: 2.0 },
      { tool: 'scan', model: 'obvious', units: 1, costCredits: 10.0 },
    ])
    expect(rows).toEqual([
      { tool: 'scan', model: 'obvious', calls: 1, units: 1, costCredits: 10.0 },
      { tool: 'llm', model: 'haiku', calls: 2, units: 30, costCredits: 3.0 },
      { tool: 'llm', model: 'sonnet', calls: 1, units: 5, costCredits: 3.0 },
    ])
  })

  it('returns an empty breakdown for no usage', () => {
    expect(usageBreakdown([])).toEqual([])
  })
})

describe('aTierAccuracy', () => {
  it('computes the correct share', () => {
    expect(aTierAccuracy({ aTierChecked: 9, aTierCorrect: 8 })).toBeCloseTo(0.888888, 5)
  })
  it('returns null when nothing was checked — never a fake 0%', () => {
    expect(aTierAccuracy({ aTierChecked: 0, aTierCorrect: 0 })).toBeNull()
  })
})

describe('formatters', () => {
  it('formats credits with two decimals', () => {
    expect(formatCredits(318.26)).toBe('318.26')
    expect(formatCredits(-80)).toBe('-80.00')
  })
  it('formats UTC timestamps deterministically', () => {
    expect(formatTimestamp('2026-11-02T06:00:04Z')).toBe('2026-11-02 06:00')
  })
  it('formats durations; in-flight runs show a dash', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(420)).toBe('420 ms')
    expect(formatDuration(96_500)).toBe('1m 37s')
    expect(formatDuration(723_000)).toBe('12m 3s')
  })
})
