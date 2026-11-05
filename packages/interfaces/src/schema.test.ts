import { describe, expect, it } from 'vitest'
import {
  formatViolations,
  schemaSpecProblems,
  validateAgainstSchema,
  type SchemaSpec,
} from './schema'

describe('schemaSpecProblems', () => {
  it('accepts a well-formed spec', () => {
    const spec: SchemaSpec = {
      keywords: { type: 'string[]', description: 'Monitoring keywords', required: true },
      cap: { type: 'number', description: 'Max results' },
    }
    expect(schemaSpecProblems(spec)).toEqual([])
  })

  it('rejects unknown field types and missing descriptions', () => {
    const problems = schemaSpecProblems({
      bad: { type: 'float128', description: 'not a real type' },
      worse: { type: 'string', description: '' },
    })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/bad.*unknown type/)
    expect(problems[1]).toMatch(/worse.*description/)
  })

  it('rejects non-object specs', () => {
    expect(schemaSpecProblems(null)).toHaveLength(1)
    expect(schemaSpecProblems([1, 2])).toHaveLength(1)
  })
})

describe('validateAgainstSchema', () => {
  const spec: SchemaSpec = {
    workspaceId: { type: 'string', description: 'Tenant id', required: true },
    quota: { type: 'number', description: 'Monthly lead quota' },
    bulk: { type: 'boolean', description: 'Expanded scan request' },
    keywords: { type: 'string[]', description: 'Scan keywords' },
    scores: { type: 'number[]', description: 'Signal scores' },
    marketMap: { type: 'object', description: 'Market map payload' },
    leads: { type: 'object[]', description: 'Scored leads' },
  }

  it('passes a value satisfying every declared field', () => {
    const check = validateAgainstSchema(spec, {
      workspaceId: 'ws-1',
      quota: 50,
      bulk: true,
      keywords: ['LED display'],
      scores: [0.8, 0.5],
      marketMap: { regions: ['Germany'] },
      leads: [{ company: 'Fairground GmbH' }],
    })
    expect(check).toEqual({ ok: true })
  })

  it('names the exact path of each violation', () => {
    const check = validateAgainstSchema(spec, {
      quota: 'fifty',
      keywords: ['ok', 42],
      marketMap: 'not-an-object',
    })
    expect(check.ok).toBe(false)
    if (check.ok) return
    const paths = check.violations.map((violation) => violation.path)
    expect(paths).toContain('workspaceId')
    expect(paths).toContain('quota')
    expect(paths).toContain('keywords')
    expect(paths).toContain('marketMap')
    expect(formatViolations(check)).toMatch(/workspaceId: required field is missing/)
  })

  it('requires an object value', () => {
    expect(validateAgainstSchema(spec, 'nope').ok).toBe(false)
    expect(validateAgainstSchema(spec, null).ok).toBe(false)
    expect(validateAgainstSchema(spec, [1]).ok).toBe(false)
  })

  it('lets undeclared keys pass through', () => {
    const check = validateAgainstSchema({ cap: { type: 'number', description: 'Cap' } }, {
      cap: 5,
      extra: 'allowed',
    })
    expect(check).toEqual({ ok: true })
  })

  it('treats an explicit undefined as absent', () => {
    const check = validateAgainstSchema(
      { quota: { type: 'number', description: 'Quota', required: true } },
      { quota: undefined },
    )
    expect(check.ok).toBe(false)
  })
})
