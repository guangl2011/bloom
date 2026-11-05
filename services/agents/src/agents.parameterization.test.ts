import { describe, expect, it } from 'vitest'
import { createFailingScanEngine } from './tools/mocks'
import { composeScanEngine } from './runtime/scan'
import {
  MemoryApproval,
  agentById,
  buildStack,
  makeContext,
  mutatedConfig,
  referenceConfig,
} from './testing/harness'

/**
 * Parameterization proof (spec D3 acceptance criteria): changing the workflow
 * config — the compiled form of the customer's intake.json — changes agent
 * behavior with ZERO code edits. Every test below mutates only the config
 * fixture and observes different agent behavior; no agent, tool, or runtime
 * code is touched.
 */

describe('config-driven scan behavior', () => {
  it('queries the scan engine with the config keywords and regions — a keyword change reaches the engine untouched', async () => {
    const config = referenceConfig()
    const stack = buildStack(config)
    const agent = agentById(stack, 'revenue-intelligence')

    await agent.run(makeContext(config, {}, new MemoryApproval()))
    expect(stack.engines.obvious.queries[0]?.keywords).toEqual([
      'custom exhibition stands',
      'modular trade show booths',
    ])

    // Config change: new keywords/regions — same code, different behavior.
    const repositioned = mutatedConfig((draft) => {
      draft.marketIntel.keywords = ['CNC machining services']
      draft.marketIntel.regions = ['Southeast Asia']
    })
    const stack2 = buildStack(repositioned)
    await agentById(stack2, 'revenue-intelligence').run(
      makeContext(repositioned, {}, new MemoryApproval()),
    )
    expect(stack2.engines.obvious.queries[0]?.keywords).toEqual(['CNC machining services'])
    expect(stack2.engines.obvious.queries[0]?.regions).toEqual(['Southeast Asia'])
  })

  it('flips the scan path when engine.primary changes — zero agent-code edits', async () => {
    const flipped = mutatedConfig((draft) => {
      draft.purchaseSignals.engine = { primary: 'deepline', fallback: 'obvious' }
    })
    const stack = buildStack(flipped)
    const result = await agentById(stack, 'revenue-intelligence').run(
      makeContext(flipped, {}, new MemoryApproval()),
    )

    expect(result.status).toBe('ok')
    expect(stack.engines.deepline.queries.length).toBe(1)
    expect(stack.engines.obvious.queries.length).toBe(0)
    // Signals carry the producing engine's id into the workspace record.
    const data = result.data as { signals: { source: string }[] }
    expect(data.signals.every((signal) => signal.source === 'deepline')).toBe(true)
  })

  it('caps signals at the config maxSignalsPerPeriod', async () => {
    const capped = mutatedConfig((draft) => {
      draft.purchaseSignals.maxSignalsPerPeriod = 1
    })
    const stack = buildStack(capped)
    const result = await agentById(stack, 'revenue-intelligence').run(
      makeContext(capped, {}, new MemoryApproval()),
    )
    const data = result.data as { signals: unknown[] }
    expect(data.signals.length).toBe(1)
  })

  it('fails over to the config fallback engine when the primary fails', async () => {
    const stack = buildStack(referenceConfig())
    // Primary dies post-activation — the composed chain must survive via config fallback.
    const composed = composeScanEngine(referenceConfig(), {
      obvious: createFailingScanEngine('obvious', 'obvious engine down'),
      deepline: stack.engines.deepline,
    })
    const signals = await composed.scan({
      keywords: [...referenceConfig().marketIntel.keywords],
      regions: [...referenceConfig().marketIntel.regions],
    })
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((signal) => signal.source === 'deepline')).toBe(true)
    expect(stack.engines.deepline.queries.length).toBe(1)
  })
})

describe('config-driven lead pool', () => {
  it('caps the pool at the config quota', async () => {
    const capped = mutatedConfig((draft) => {
      draft.leadScoring!.monthlyQuota = 3
    })
    const stack = buildStack(capped)
    const result = await agentById(stack, 'lead').run(makeContext(capped, {}, new MemoryApproval()))
    const data = result.data as { quota: number; leads: { company: string }[] }
    expect(data.quota).toBe(3)
    expect(data.leads.length).toBe(3)
    expect(data.leads[0]?.company).toBe('Aurora Exhibits')
  })

  it('re-tiers the same leads when tier bounds change in config', async () => {
    // Aurora scores ~0.83: A under the reference bands, B when the A floor rises.
    const raised = mutatedConfig((draft) => {
      draft.leadScoring!.tiers = {
        A: { min: 0.95 },
        B: { min: 0.5, max: 0.95 },
        C: { min: 0.3, max: 0.5 },
      }
    })
    const stack = buildStack(raised)
    const result = await agentById(stack, 'lead').run(makeContext(raised, {}, new MemoryApproval()))
    const data = result.data as { leads: { company: string; tier: string }[] }
    const aurora = data.leads.find((lead) => lead.company === 'Aurora Exhibits')
    expect(aurora?.tier).toBe('B')
  })

  it('re-weights scores when ICP criteria weights change in config', async () => {
    // Pacific Rim Trading has decision_chain 0.9 and weak product fit.
    // Boosting decision_chain's weight to dominate flips the ranking.
    const reweighted = mutatedConfig((draft) => {
      draft.icp.criteria = [
        { id: 'product_fit', description: 'Product fit', weight: 0.1 },
        { id: 'growth_signal', description: 'Growth signals', weight: 0.1 },
        { id: 'decision_chain', description: 'Decision maker reachable', weight: 0.8 },
      ]
    })
    const stack = buildStack(reweighted)
    const result = await agentById(stack, 'lead').run(makeContext(reweighted, {}, new MemoryApproval()))
    const data = result.data as { leads: { company: string }[] }
    expect(data.leads[0]?.company).toBe('Pacific Rim Trading')
  })
})

describe('config-driven outreach', () => {
  const leadsInput = [
    { company: 'Aurora Exhibits', contact: 'ops@aurora-exhibits.example', score: 0.9, tier: 'A' },
    { company: 'Cascadia Events', contact: 'hello@cascadia-events.example', score: 0.7, tier: 'B' },
    { company: 'NordMed Messe', contact: 'sales@nordmed-messe.example', score: 0.6, tier: 'B' },
  ]

  it('honors the config dailySendCap — lowering it queues more approved mail', async () => {
    const lowered = mutatedConfig((draft) => {
      draft.outreach!.dailySendCap = 1
    })
    const stack = buildStack(lowered)
    const result = await agentById(stack, 'outreach').run(
      makeContext(lowered, { leads: leadsInput }, new MemoryApproval()),
    )
    const data = result.data as { sent: number; queued: number }
    expect(data.sent).toBe(1)
    expect(data.queued).toBe(2)
    expect(stack.email.sent.length).toBe(1)
  })

  it('drafts from config content — changing keywords changes the email copy with no code edits', async () => {
    const repositioned = mutatedConfig((draft) => {
      draft.marketIntel.keywords = ['LED display walls']
    })
    const stack = buildStack(repositioned)
    await agentById(stack, 'outreach').run(
      makeContext(repositioned, { leads: leadsInput.slice(0, 1) }, new MemoryApproval()),
    )
    expect(stack.email.drafts[0]?.subject).toContain('LED display walls')
  })
})

describe('config-driven roster activation', () => {
  it('downgrades to the Intelligence Starter roster when the package changes', () => {
    const starter = mutatedConfig((draft) => {
      draft.package = 'intelligence_starter'
      draft.leadScoring = undefined
      draft.outreach = undefined
      draft.ads = undefined
    })
    const stack = buildStack(starter)
    expect(stack.agents.map((agent) => agent.id)).toEqual(['revenue-intelligence', 'icp'])
  })

  it('drops the ad agent when the ads block is removed from an otherwise Lead Pro config', () => {
    const noAds = mutatedConfig((draft) => {
      draft.ads = undefined
    })
    const stack = buildStack(noAds)
    expect(stack.agents.map((agent) => agent.id)).toEqual([
      'revenue-intelligence',
      'icp',
      'lead',
      'outreach',
      'conversion',
    ])
  })

  it('rejects an inconsistent config at activation instead of half-running', () => {
    // Deliberately bypasses mutatedConfig: this exercises the roster's own
    // activation guard, below the fixture validator that would also refuse it.
    const broken = { ...referenceConfig(), leadScoring: undefined }
    expect(() => buildStack(broken)).toThrow(/leadScoring block/)
  })
})
