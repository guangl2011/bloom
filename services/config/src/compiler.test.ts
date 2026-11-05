import { describe, expect, it } from 'vitest'
import { AGENT_IDS, GATE_ACTIONS } from '@bloom/interfaces'
import { compileWorkflowConfig, parseWorkflowConfig } from './compiler.js'
import { generateIntakeSchema, IntakeValidationError, normalizeIntake, validateIntake } from './intake-schema.js'
import { DEFAULT_TIERS } from './mapping.js'
import { loadFieldMap, loadReferenceIntake } from './testutil.js'

const fieldMap = loadFieldMap()
const reference = loadReferenceIntake()

function compile(intake: unknown = reference) {
  return compileWorkflowConfig(intake, fieldMap, { customer: 'reference-medspa', version: 1 })
}

describe('schema generated from the field map', () => {
  it('derives properties, required flags, and descriptions from the CSV — never hand-maintained', () => {
    const schema = generateIntakeSchema(fieldMap)
    const company = schema.properties?.['company']
    expect(company?.type).toBe('object')
    expect(company?.properties?.['name']?.type).toBe('string')
    expect(schema.required).toContain('company')
    expect(company?.required).toContain('name')
    expect(company?.properties?.['name']?.description).toContain('必填')
  })

  it('caps indexed template rows (competitors.list at 5) and enum-validates the package', () => {
    const schema = generateIntakeSchema(fieldMap)
    expect(schema.properties?.['competitors']?.properties?.['list']?.maxItems).toBe(5)
    expect(schema.properties?.['package']?.enum).toEqual(['intelligence_starter', 'lead_generation_pro'])
  })
})

describe('intake validation errors name the exact sheet and field', () => {
  it('rejects a missing required field with sheet + source row (spec D2/D3 acceptance)', () => {
    const missing = structuredClone(reference)
    delete (missing['markets'] as Record<string, unknown>)['regions']
    expect(() => validateIntake(normalizeIntake(missing, fieldMap), fieldMap)).toThrow(IntakeValidationError)
    try {
      validateIntake(normalizeIntake(missing, fieldMap), fieldMap)
      expect.unreachable('validation must throw')
    } catch (error) {
      const issue = (error as IntakeValidationError).issues.find((i) => i.path === 'markets.regions')
      expect(issue?.sheet).toContain('03_目标行业与区域')
      expect(issue?.field).toContain('3.2')
      expect(issue?.message).toContain('缺少必填')
    }
  })

  it('rejects unknown intake fields — answers outside the template cannot reach config', () => {
    const rogue = structuredClone(reference)
    ;(rogue['company'] as Record<string, unknown>)['nickname'] = 'Sneaky Co'
    expect(() => normalizeIntake(rogue, fieldMap)).toThrow(IntakeValidationError)
  })

  it('rejects intake attempting to set platform-reserved config (engine selection)', () => {
    const rogue = structuredClone(reference)
    ;(rogue['purchase_signals'] as Record<string, unknown>) = { engine: 'deepline-only' }
    expect(() => normalizeIntake(rogue, fieldMap)).toThrow(IntakeValidationError)
  })

  it('rejects an unknown service package', () => {
    const bad = structuredClone(reference)
    ;(bad as Record<string, unknown>)['package'] = 'enterprise'
    expect(() => validateIntake(normalizeIntake(bad, fieldMap), fieldMap)).toThrow(/must be one of the two service packages/)
  })

  it('enforces the per-package monitor keyword limits (Starter ≤10, Lead Pro ≤30)', () => {
    const starter = structuredClone(reference)
    ;(starter as Record<string, unknown>)['package'] = 'intelligence_starter'
    const keywords = (starter['keywords'] as Record<string, unknown>)
    keywords['monitor'] = Array.from({ length: 11 }, (_, i) => `keyword number ${i + 1}`)
    try {
      validateIntake(normalizeIntake(starter, fieldMap), fieldMap)
      expect.unreachable('11 keywords must exceed the Starter limit')
    } catch (error) {
      const issue = (error as IntakeValidationError).issues.find((i) => i.path === 'keywords.monitor')
      expect(issue?.message).toContain('11 > 10')
    }
  })

  it('requires quota, send cap, and signal cap answers to be positive integers', () => {
    const bad = structuredClone(reference)
    ;(bad['icp'] as Record<string, unknown>)['monthlyQuota'] = 'fifty'
    expect(() => validateIntake(normalizeIntake(bad, fieldMap), fieldMap)).toThrow(/monthly lead quota/)
  })

  it('enforces template row caps (6 competitors > 5 rows)', () => {
    const bad = structuredClone(reference)
    ;(bad['competitors'] as Record<string, unknown>)['list'] = [...(reference['competitors'] as { list: string[] }).list, 'Extra Co', 'Another Co']
    expect(() => validateIntake(normalizeIntake(bad, fieldMap), fieldMap)).toThrow(/template's 5 rows/)
  })
})

describe('compiled reference config (Lead Pro)', () => {
  const compiled = compile()

  it('carries the spec reference shape: package, engine, scoring model, tiers', () => {
    expect(compiled.config.package).toBe('lead_generation_pro')
    expect(compiled.config.workflow['purchase_signals']).toMatchObject({
      engine: { primary: 'obvious', fallback: 'deepline' },
      schedule: '0 6 * * 1',
      schedule_source: 'weekly',
      max_signals_per_period: 50,
    })
    expect(compiled.config.workflow['lead_scoring']).toMatchObject({
      model: 'internal_v1',
      tiers: DEFAULT_TIERS,
      monthly_quota: 50,
      tuning: { criteria_a: expect.stringContaining('containers per quarter') },
    })
  })

  it('converts cadence answers into cron schedules with provenance kept', () => {
    const marketIntel = compiled.config.workflow['market_intel'] as Record<string, unknown>
    expect(marketIntel['schedule']).toBe('0 6 1 * *') // monthly brief by the 1st
    expect(marketIntel['schedule_source']).toBe('monthly')
  })

  it('always emits the full approval gate list — a hard invariant, never config-off', () => {
    expect(compiled.config.approval['gate_actions']).toEqual([...GATE_ACTIONS])
  })

  it('emits the six-agent roster for Lead Pro and the two-agent roster for Starter', () => {
    expect(compiled.config.agent_roster).toEqual([...AGENT_IDS])
    const starter = structuredClone(reference)
    ;(starter as Record<string, unknown>)['package'] = 'intelligence_starter'
    const starterConfig = compileWorkflowConfig(starter, fieldMap, { customer: 'reference-medspa', version: 1 }).config
    expect(starterConfig.agent_roster).toEqual(['revenue-intelligence', 'icp'])
  })

  it('omits Lead-Pro-only sections for Starter — no agent a package did not buy', () => {
    const starter = structuredClone(reference)
    ;(starter as Record<string, unknown>)['package'] = 'intelligence_starter'
    const starterConfig = compileWorkflowConfig(starter, fieldMap, { customer: 'reference-medspa', version: 1 }).config
    expect(starterConfig.workflow['outreach']).toBeUndefined()
    expect(starterConfig.workflow['competitor_tracking']).toBeUndefined()
    expect(starterConfig.workflow['lead_scoring'] && (starterConfig.workflow['lead_scoring'] as Record<string, unknown>)['monthly_quota']).toBeUndefined()
    expect(starterConfig.workflow['market_intel']).toBeDefined() // briefs still run
  })

  it('extracts emails for approval routing and delivery recipients', () => {
    expect(compiled.config.approval['approvers']).toMatchObject({
      emails: ['liwei@example.com', 'chenmei@example.com'],
    })
    expect(compiled.config['delivery']).toMatchObject({
      recipient_list: { emails: ['liwei@example.com', 'chenmei@example.com'] },
    })
  })

  it('emits read-only ad platforms for the two supported networks only', () => {
    expect(compiled.config['ads']).toMatchObject({ platforms: ['google', 'linkedin'] })
  })
})

describe('config-driven customization (no code edits)', () => {
  it('changing the intake changes the config — the D3 parameterization requirement', () => {
    const modified = structuredClone(reference)
    ;(modified['icp'] as Record<string, unknown>)['monthlyQuota'] = '75'
    ;(modified['markets'] as Record<string, unknown>)['regions'] = ['Spain', 'Portugal']
    const a = compile().config
    const b = compileWorkflowConfig(modified, fieldMap, { customer: 'reference-medspa', version: 2 }).config
    expect((a.workflow['lead_scoring'] as Record<string, unknown>)['monthly_quota']).toBe(50)
    expect((b.workflow['lead_scoring'] as Record<string, unknown>)['monthly_quota']).toBe(75)
    expect(b.workflow['market_map']).toMatchObject({ regions: ['Spain', 'Portugal'] })
  })
})

describe('YAML round trip', () => {
  it('parses emitted YAML back to the same config', () => {
    const compiled = compile()
    expect(parseWorkflowConfig(compiled.yaml)).toEqual(compiled.config)
  })
})
