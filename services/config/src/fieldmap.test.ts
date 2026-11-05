import { describe, expect, it } from 'vitest'
import { FieldMap, FieldMapError, normalizeIntakeKey, parseCsv } from './fieldmap.js'
import { loadFieldMap, loadFieldMapCsvText } from './testutil.js'

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas, quotes, and newlines', () => {
    const csv = '"a","b,c","say ""hi""","line1\nline2"\r\n"5","6","7","8"\r\n'
    expect(parseCsv(csv)).toEqual([
      ['a', 'b,c', 'say "hi"', 'line1\nline2'],
      ['5', '6', '7', '8'],
    ])
  })

  it('keeps an unquoted trailing field on the last line', () => {
    expect(parseCsv('x,y\nz,w')).toEqual([
      ['x', 'y'],
      ['z', 'w'],
    ])
  })
})

describe('normalizeIntakeKey', () => {
  it('collapses indexed template rows to their list form', () => {
    expect(normalizeIntakeKey('competitors.list[0]')).toBe('competitors.list')
    expect(normalizeIntakeKey('competitors.list[4]')).toBe('competitors.list')
    expect(normalizeIntakeKey('company.name')).toBe('company.name')
  })
})

describe('FieldMap.fromCsv (the real generated template)', () => {
  it('loads all 77 template fields', () => {
    expect(loadFieldMap().entries.length).toBe(77)
  })

  it('marks required fields from 必填 and splits semicolon-separated config keys', () => {
    const fieldMap = loadFieldMap()
    const name = fieldMap.entry('company.name')
    expect(name?.required).toBe(true)
    expect(name?.configKeys).toEqual(['knowledge_base', 'market_intel.seed'])
    expect(fieldMap.entry('company.brand')?.required).toBe(false)
  })

  it('treats competitors.list[0..4] as one required list, indexed rows addressable', () => {
    const fieldMap = loadFieldMap()
    // Row [0] carries the list-level 必填; every indexed row is directly addressable.
    expect(fieldMap.entry('competitors.list[0]')?.required).toBe(true)
    expect(fieldMap.entry('competitors.list[3]')?.intakeKey).toBe('competitors.list[3]')
    expect(fieldMap.entry('competitors.list[3]')?.configKeys).toEqual(['competitor_tracking'])
  })

  it('rejects duplicate intake keys', () => {
    const rows = loadFieldMapCsvText().trimEnd().split('\n')
    rows.push(rows[1] as string) // duplicate the first data row (company.name)
    expect(() => FieldMap.fromCsv(rows.join('\n') + '\n')).toThrow(FieldMapError)
  })

  it('rejects CSVs whose header drifted from the generator', () => {
    const csv = loadFieldMapCsvText().replace('intake 键 Intake key', 'key')
    expect(() => FieldMap.fromCsv(csv)).toThrow(FieldMapError)
  })

  it('rejects rows that feed no config keys', () => {
    const rows = loadFieldMapCsvText().trimEnd().split('\n')
    rows.push('"8.99","mystery.field","01_公司概况 / Company Profile","9.99","选填","","配置/运行时",""')
    expect(() => FieldMap.fromCsv(rows.join('\n') + '\n')).toThrow(FieldMapError)
  })

  it('reverse-maps config keys back to the intake fields that feed them', () => {
    const fieldMap = loadFieldMap()
    const feeders = fieldMap.entriesForConfigKey('icp.scoringTuning')
    expect(feeders.length).toBeGreaterThan(3)
    expect(feeders.map((entry) => entry.intakeKey)).toContain('icp.criteriaA')
  })
})
