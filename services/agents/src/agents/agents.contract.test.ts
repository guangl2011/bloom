import { describe, expect, it } from 'vitest'
import type { AgentResult, SkillDefinition } from '@bloom/interfaces'
import { validateAgainstSchema, formatViolations, AGENT_IDS } from '@bloom/interfaces'
import {
  MemoryApproval,
  agentById,
  buildStack,
  makeContext,
  referenceConfig,
  skillById,
} from '../testing/harness'
import { scoreLead, normalizeCriteriaWeights } from '../scoring/internal-v1'
import { REVENUE_INTELLIGENCE_BOUNDARY } from './revenue-intelligence'
import { ICP_BOUNDARY } from './icp'
import { LEAD_BOUNDARY } from './lead'
import { OUTREACH_BOUNDARY } from './outreach'
import { AD_BOUNDARY } from './ad'
import { CONVERSION_BOUNDARY } from './conversion'

/**
 * Interface contract tests for all six agents (spec D3 acceptance criteria):
 * every agent runs behind AgentInterface, validates untrusted input against
 * its skill's typed schema, returns schema-valid output, stamps workspace_id,
 * and honors its boundary — gate actions only through the approval gate.
 */

const config = referenceConfig()

function assertOutputMatchesSkillSchema(skill: SkillDefinition, result: AgentResult): void {
  expect(result.status).toBe('ok')
  const check = validateAgainstSchema(skill.outputSchema, result.data)
  if (!check.ok) {
    expect.fail(`output violates skill ${skill.name} schema: ${formatViolations(check)}`)
  }
  expect(check.ok).toBe(true)
}

describe('all six agents', () => {
  it('activates one skill per agent id and exposes the spec boundary', () => {
    const stack = buildStack(config)
    expect(stack.agents.map((agent) => agent.id).sort()).toEqual([...AGENT_IDS].sort())
    for (const agent of stack.agents) {
      expect(agent.boundary.length).toBeGreaterThan(0)
    }
  })

  it('rejects malformed input against the skill schema instead of failing mid-run', async () => {
    const stack = buildStack(config)
    const approvals = new MemoryApproval()
    for (const agent of stack.agents) {
      // A string is not an object — every skill schema must reject it at the boundary.
      const result = await agent.run(makeContext(config, 'not-an-object', approvals))
      expect(result.status).toBe('error')
      expect(result.error).toMatch(/invalid input for skill/)
    }
    expect(approvals.requests).toHaveLength(0)
  })
})

describe('revenue-intelligence', () => {
  it('scans with config keywords/regions, caps signals, stamps workspace_id', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'revenue-intelligence').run(
      makeContext(config, {}, new MemoryApproval()),
    )
    assertOutputMatchesSkillSchema(skillById('revenue-intelligence'), result)

    expect(stack.engines.obvious.queries[0]?.keywords).toEqual(config.marketIntel.keywords)
    expect(stack.engines.obvious.queries[0]?.regions).toEqual(config.marketIntel.regions)
    const data = result.data as { signals: { workspaceId: string }[] }
    expect(data.signals.length).toBeLessThanOrEqual(config.purchaseSignals.maxSignalsPerPeriod)
    for (const signal of data.signals) {
      expect(signal.workspaceId).toBe(config.workspaceId)
    }
  })

  it('routes bulk scans through the bulk_scan gate and honors a rejection', async () => {
    const stack = buildStack(config)
    const denied = new MemoryApproval(() => false)
    const result = await agentById(stack, 'revenue-intelligence').run(
      makeContext(config, { bulk: true }, denied),
    )
    expect(result.status).toBe('error')
    expect(denied.requests[0]?.action).toBe('bulk_scan')
    expect(denied.requests[0]?.skill).toEqual({
      name: 'market-map-v1',
      version: 1,
    })
    expect(result.error).toMatch(/rejected by approver/)

    const approved = new MemoryApproval()
    const okResult = await agentById(stack, 'revenue-intelligence').run(
      makeContext(config, { bulk: true }, approved),
    )
    expect(okResult.status).toBe('ok')
    expect(approved.decisions[0]?.approved).toBe(true)
  })

  it('declares the spec boundary verbatim', () => {
    expect(REVENUE_INTELLIGENCE_BOUNDARY).toBe('No outreach, no CRM writes, no execution')
  })
})

describe('icp', () => {
  it('tunes internal_v1 weights from the config criteria, normalized to 1', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'icp').run(makeContext(config, {}, new MemoryApproval()))
    assertOutputMatchesSkillSchema(skillById('icp'), result)

    const data = result.data as { model: string; weights: Record<string, number> }
    expect(data.model).toBe('internal_v1')
    const total = Object.values(data.weights).reduce((sum, weight) => sum + weight, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(data.weights['product_fit']).toBeCloseTo(0.5, 10)
  })
})

describe('lead', () => {
  it('is not activated without the leadScoring block (a package never runs an agent it did not buy)', () => {
    const starter = structuredClone(referenceConfig())
    // Simulate an Intelligence Starter config: Lead Pro blocks removed.
    const starterConfig = {
      ...starter,
      package: 'intelligence_starter' as const,
      leadScoring: undefined,
      outreach: undefined,
      ads: undefined,
    }
    const stack = buildStack(starterConfig)
    expect(stack.agents.map((agent) => agent.id)).toEqual(['revenue-intelligence', 'icp'])
  })

  it('scores, ranks, tiers, and caps the pool at the configured quota with rationale', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'lead').run(makeContext(config, {}, new MemoryApproval()))
    assertOutputMatchesSkillSchema(skillById('lead'), result)

    const data = result.data as { quota: number; leads: { company: string; score: number; tier: string; rationale: string }[] }
    expect(data.quota).toBe(50)
    expect(data.leads.length).toBe(6)

    const tuning = normalizeCriteriaWeights(config.icp.criteria)
    const scores = data.leads.map((lead) => lead.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(data.leads[0]?.company).toBe('Aurora Exhibits')
    expect(data.leads[0]?.tier).toBe('A')
    for (const lead of data.leads) {
      expect(lead.rationale).toMatch(/product_fit/)
    }
    expect(tuning['product_fit']).toBeCloseTo(0.5, 10)
  })

  it('caps the pool when the config quota drops below the candidate count', async () => {
    const { mutatedConfig } = await import('../testing/harness')
    const capped = mutatedConfig((draft) => {
      draft.leadScoring!.monthlyQuota = 3
    })
    const stack = buildStack(capped)
    const result = await agentById(stack, 'lead').run(makeContext(capped, {}, new MemoryApproval()))
    const data = result.data as { quota: number; leads: unknown[] }
    expect(data.leads.length).toBe(3)
  })

  it('errors without the leadScoring config block even when run directly', async () => {
    const stack = buildStack(config)
    const leadAgent = agentById(stack, 'lead')
    const noScoring = { ...config, leadScoring: undefined }
    const result = await leadAgent.run(makeContext(noScoring, {}, new MemoryApproval()))
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/leadScoring/)
  })
})

describe('outreach', () => {
  const leadsInput = [
    { company: 'Aurora Exhibits', contact: 'ops@aurora-exhibits.example', score: 0.83, tier: 'A' },
    { company: 'Cascadia Events', contact: 'hello@cascadia-events.example', score: 0.6, tier: 'B' },
    { company: 'NordMed Messe', contact: 'sales@nordmed-messe.example', score: 0.59, tier: 'B' },
  ]

  it('drafts for every lead and only sends approved mail within the daily cap', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'outreach').run(
      makeContext(config, { leads: leadsInput }, new MemoryApproval()),
    )
    assertOutputMatchesSkillSchema(skillById('outreach'), result)

    const email = stack.email
    expect(email.drafts.length).toBe(3)
    // dailySendCap is 2 in the reference config: 2 sent, 1 approved-but-queued.
    expect(email.sent.length).toBe(2)
    const data = result.data as { workspaceId: string; drafts: number; sent: number; queued: number; rejected: number }
    expect(data).toEqual({
      workspaceId: config.workspaceId,
      drafts: 3,
      sent: 2,
      queued: 1,
      rejected: 0,
    })
    for (const sent of email.sent) {
      expect(sent.approvalDecisionId).toMatch(/^dec-/)
      expect(sent.approver).toBe('fixture-approver')
    }
  })

  it('records the email_send gate request with skill name and version', async () => {
    const stack = buildStack(config)
    const approvals = new MemoryApproval()
    await agentById(stack, 'outreach').run(makeContext(config, { leads: leadsInput.slice(0, 1) }, approvals))
    expect(approvals.requests[0]?.action).toBe('email_send')
    expect(approvals.requests[0]?.requestedBy).toBe('outreach')
    expect(approvals.requests[0]?.skill).toEqual({ name: 'email-draft-v1', version: 1 })
  })

  it('never sends when the approver rejects every request', async () => {
    const stack = buildStack(config)
    const denied = new MemoryApproval(() => false)
    const result = await agentById(stack, 'outreach').run(
      makeContext(config, { leads: leadsInput }, denied),
    )
    expect(stack.email.sent.length).toBe(0)
    const data = result.data as { rejected: number; sent: number }
    expect(data.rejected).toBe(3)
    expect(data.sent).toBe(0)
  })
})

describe('ad', () => {
  it('rejects platforms outside the config contract', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'ad').run(
      makeContext(config, { platforms: ['tiktok'] }, new MemoryApproval()),
    )
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/outside the contract/)
  })

  it('produces read-only recommendations from campaign status', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'ad').run(makeContext(config, {}, new MemoryApproval()))
    assertOutputMatchesSkillSchema(skillById('ad'), result)

    const data = result.data as {
      recommendations: { platform: string; action: string; readOnly: boolean }[]
    }
    const actions = data.recommendations.map((recommendation) => recommendation.action)
    expect(actions).toContain('review_budget') // google campaign at 95% spend
    expect(actions).toContain('refresh_creative') // linkedin campaign limited
    for (const recommendation of data.recommendations) {
      expect(recommendation.readOnly).toBe(true)
    }
  })
})

describe('conversion', () => {
  const opportunitiesInput = [
    { opportunityId: 'opp-1', nextStage: 'qualified' },
    { opportunityId: 'opp-2', nextStage: 'proposal' },
  ]

  it('writes approved CRM changes carrying the decision id and approver', async () => {
    const stack = buildStack(config)
    const result = await agentById(stack, 'conversion').run(
      makeContext(config, { opportunities: opportunitiesInput }, new MemoryApproval()),
    )
    assertOutputMatchesSkillSchema(skillById('conversion'), result)

    const crm = stack.crm
    expect(crm.writes.length).toBe(2)
    expect(crm.writes[0]?.approvalDecisionId).toMatch(/^dec-/)
    const data = result.data as { written: number; rejected: number }
    expect(data.written).toBe(2)
    expect(data.rejected).toBe(0)
  })

  it('writes nothing when the approver rejects and reports the rejected ids', async () => {
    const stack = buildStack(config)
    const denied = new MemoryApproval(() => false)
    const result = await agentById(stack, 'conversion').run(
      makeContext(config, { opportunities: opportunitiesInput }, denied),
    )
    expect(stack.crm.writes.length).toBe(0)
    const data = result.data as { rejected: number; rejectedIds: string[] }
    expect(data.rejected).toBe(2)
    expect(data.rejectedIds).toEqual(['opp-1', 'opp-2'])
  })

  it('scores the fixture lead pool through the same tuning the lead agent uses', () => {
    // Cross-check: the internal_v1 model is the single scoring path.
    const tuning = normalizeCriteriaWeights(config.icp.criteria)
    expect(scoreLead(FIXTURE_SIGNALS_AURORA, tuning)).toBeGreaterThan(0.8)
  })
})

const FIXTURE_SIGNALS_AURORA = { product_fit: 0.9, growth_signal: 0.8, decision_chain: 0.7 }

// Boundary constants re-declared here would drift — assert the imported ones.
describe('boundaries', () => {
  it('carries the six spec boundaries', () => {
    expect(ICP_BOUNDARY).toBe('No outreach or ad execution')
    expect(LEAD_BOUNDARY).toBe('No auto-contact, no direct CRM updates')
    expect(OUTREACH_BOUNDARY).toBe('Nothing sends without a human approval decision')
    expect(AD_BOUNDARY).toBe('Never spends, never modifies a live campaign in v1.0')
    expect(CONVERSION_BOUNDARY).toBe('No CRM record modified without sign-off')
  })
})
