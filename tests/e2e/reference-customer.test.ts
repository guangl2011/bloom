/**
 * Reference-customer full-cycle e2e (spec D5, wave C).
 *
 * Display Factory Wholesale — the synthetic Lead Generation Pro customer —
 * runs the WHOLE v1.0 pipeline against compose Postgres with the real service
 * libraries, mocks only at the network transport seam:
 *
 *   filled intake → D2 round-trip → D3c compile (versioned YAML, byte-equal
 *   to the committed deployment artifact) → six agents on Hermes execute a
 *   full workflow cycle (market intel → signals scan via the
 *   ScanEngineInterface test transport → ICP/internal_v1 scoring → lead
 *   selection → outreach DRAFTING) → P0 approval gate blocks email/CRM sends
 *   pending approval → approve through the dashboard path (the same gate the
 *   wired decide route calls) → adapter-level send via the stub provider.
 *
 * Zero-send guarantee stays armed end to end: `fetch` is rigged to throw, so
 * any network attempt anywhere in the cycle fails this suite. The only send
 * is the stub provider recording in memory.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPgExecutorFromUrl, loadMigrations, MigrationRunner } from '@bloom/db'
import { compileWorkflowConfig, FieldMap, parseWorkflowConfig, runtimeConfigFromCompiled } from '@bloom/svc-config'
import { activateAgents, type AgentToolset } from '@bloom/svc-agents/roster'
import { HermesAgentRuntime, type AgentRunRecord } from '@bloom/svc-agents/hermes'
import { defaultSkillsRoot, loadAllSkills } from '@bloom/svc-agents/skills'
import { createMockAdsAdapter, createMockLeadSourceTool, type MockCampaign, type MockCandidate } from '@bloom/svc-agents/tools'
import { createApprovalGate } from '@bloom/svc-approval/gate'
import { PgApprovalStore } from '@bloom/svc-approval/store-pg'
import { createCrmAdapter, InMemoryCrmStore } from '@bloom/adapter-crm'
import {
  createEmailAdapter,
  createHttpEmailProvider,
  createStubEmailProvider,
  httpEmailProviderProblems,
} from '@bloom/adapter-email'
import { PgCreditLedger } from '@bloom/svc-credits/ledger-pg'
import { PgWorkflowRunStore } from '@bloom/svc-workflow/runs-pg'
import type {
  AgentContext,
  AgentId,
  ScanEngineId,
  ScanEngineInterface,
  ScanQuery,
  ScanSignal,
  WorkflowConfig,
} from '@bloom/interfaces'

const REPO_ROOT = process.cwd()
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://bloom:bloom@localhost:5432/bloom'

/** Unwraps an indexed access the test has already asserted with expect().toBeDefined(). */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`e2e harness invariant broken: ${what} is missing`)
  }
  return value
}

/**
 * Workspace for this cycle. Deterministic when pinned (BLOOM_E2E_WORKSPACE)
 * so the dashboard evidence capture can target the cycle's data; unique per
 * run otherwise so repeated runs never overlap each other's gate records.
 */
const WORKSPACE = process.env.BLOOM_E2E_WORKSPACE ?? `dfw-e2e-${Date.now()}`

/** Per-unit price catalog (credits) — mirrors the compose deployment's catalog shape. */
const PRICE_CATALOG: Record<string, number> = {
  'scan-engine': 0.5,
  'scan-engine:obvious-test': 0.4,
  'icp': 0.1,
  'lead-source': 0.2,
  'outreach-email': 0.05,
  'conversion-crm': 0.05,
  'ads-status': 0.01,
}

// ---------------------------------------------------------------------------
// Reference-customer fixtures — the transport seam's canned externals.
// ---------------------------------------------------------------------------

const DFW_SIGNALS: readonly ScanSignal[] = [
  {
    title: 'Deutsche retail group tenders shelving for 40-store refit',
    url: 'https://tenders.example/dfw/de-refit',
    source: 'obvious',
    snippet: 'Retail display shelving and checkout gondolas, delivery across DE regions in 2027',
  },
  {
    title: 'Netherlands supermarket chain plans fresh-format expansion',
    url: 'https://news.example/dfw/nl-fresh',
    source: 'obvious',
    snippet: 'Procurement of modular display systems planned for new stores in NL regions',
  },
  {
    title: 'Polish DIY chain opens supplier day for shop racking',
    url: 'https://trade.example/dfw/pl-racking',
    source: 'obvious',
    snippet: 'Sourcing warehouse and shopfloor racking suppliers in PL regions',
  },
]

const DFW_CANDIDATES: readonly MockCandidate[] = [
  {
    company: 'Nordhandel GmbH',
    contact: 'einkauf@nordhandel.example',
    country: 'DE',
    signals: { product_fit: 0.92, growth_signal: 0.85, decision_chain: 0.78 },
  },
  {
    company: 'Bloemen Markt BV',
    contact: 'inkoop@bloemenmarkt.example',
    country: 'NL',
    signals: { product_fit: 0.86, growth_signal: 0.7, decision_chain: 0.62 },
  },
  {
    company: 'Malmö Butiks AB',
    contact: 'inkop@malmo-butiks.example',
    country: 'SE',
    signals: { product_fit: 0.7, growth_signal: 0.66, decision_chain: 0.52 },
  },
  {
    company: 'Bałtyk Sklep Sp. z o.o.',
    contact: 'zakupy@baltysklep.example',
    country: 'PL',
    signals: { product_fit: 0.58, growth_signal: 0.55, decision_chain: 0.4 },
  },
]

const DFW_CAMPAIGNS: readonly MockCampaign[] = [
  { platform: 'google', campaignId: 'g-1', name: 'DE display shelving', status: 'active', budgetMonthly: 1000, spendMtd: 950 },
  { platform: 'linkedin', campaignId: 'li-1', name: 'EU retail buyers', status: 'limited', budgetMonthly: 800, spendMtd: 300 },
]

/** ScanEngineInterface test transport — the ONLY seam where a network would be. */
interface TestTransport extends ScanEngineInterface {
  readonly queries: readonly ScanQuery[]
}

function testTransport(id: ScanEngineId, signals: readonly ScanSignal[], failure?: string): TestTransport {
  const queries: ScanQuery[] = []
  return {
    id,
    queries,
    async scan(query: ScanQuery): Promise<ScanSignal[]> {
      queries.push(query)
      if (failure !== undefined) {
        throw new Error(failure)
      }
      return [...signals]
    },
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface E2EStack {
  readonly pool: Pool
  readonly config: WorkflowConfig
  readonly hermes: HermesAgentRuntime
  readonly gate: ReturnType<typeof createApprovalGate>
  readonly email: ReturnType<typeof createEmailAdapter>
  readonly crmStore: InMemoryCrmStore
  readonly stubProvider: ReturnType<typeof createStubEmailProvider>
  readonly obviousTransport: TestTransport
  readonly deeplineTransport: TestTransport
  readonly leadSource: ReturnType<typeof createMockLeadSourceTool>
  readonly ads: ReturnType<typeof createMockAdsAdapter>
  readonly ledger: PgCreditLedger
  readonly runs: PgWorkflowRunStore
}

/** Runs one stage through Hermes and persists its run record (the dashboard reads these). */
async function runStage(
  stack: E2EStack,
  agentId: AgentId,
  stage: string,
  input: unknown,
): Promise<AgentRunRecord> {
  const context: AgentContext = {
    workspaceId: WORKSPACE,
    input,
    approvals: stack.gate.asApprovalInterface(WORKSPACE),
    config: stack.config,
    runId: `cycle-${stage}`,
  }
  const record = await stack.hermes.run(agentId, context)
  await stack.runs.save({
    runId: record.runId,
    workflowId: `reference-cycle/${stage}`,
    workspaceId: WORKSPACE,
    trigger: { kind: 'schedule', rrule: '0 6 * * 1' },
    attempt: record.attempt,
    status: record.status === 'succeeded' ? 'succeeded' : 'failed',
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    steps: [
      {
        stepId: stage,
        agentId: record.agentId,
        status: record.status === 'succeeded' ? 'succeeded' : 'failed',
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        ...(record.error === undefined ? {} : { error: record.error }),
      },
    ],
    result: record.result,
  })
  return record
}

/** Charges a stage's tool calls to the ledger — every call must log cost and source. */
async function chargeStage(stack: E2EStack, tool: string, model: string, units: number): Promise<void> {
  await stack.ledger.recordUsage(WORKSPACE, { tool, model, units })
}

beforeAll(async () => {
  // Zero-send, enforced structurally: any network attempt fails the suite.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('NETWORK CALL ATTEMPTED IN E2E — zero-send guarantee violated')
  })

  const { exec, pool } = createPgExecutorFromUrl(DATABASE_URL)
  const migrations = await loadMigrations(join(REPO_ROOT, 'packages/db/migrations'))
  await new MigrationRunner((sql) => exec(sql)).run(migrations)

  const gate = createApprovalGate({ store: new PgApprovalStore(exec) })
  const stubProvider = createStubEmailProvider()
  const email = createEmailAdapter({ gate, provider: stubProvider })
  const crmStore = new InMemoryCrmStore()
  const crm = createCrmAdapter({ gate, store: crmStore })

  // The committed deployment artifact IS the reference customer's config
  // (spec D5): parse it — never hand-build a runtime config here.
  const committedYaml = readFileSync(join(REPO_ROOT, 'deployments/reference/workflow.yaml'), 'utf8')
  const compiled = parseWorkflowConfig(committedYaml)
  const config = runtimeConfigFromCompiled(compiled, { workspaceId: WORKSPACE })

  const obviousTransport = testTransport('obvious', DFW_SIGNALS)
  const deeplineTransport = testTransport('deepline', [], 'deepline must not be called while the primary is healthy')
  const leadSource = createMockLeadSourceTool(DFW_CANDIDATES)
  const ads = createMockAdsAdapter(DFW_CAMPAIGNS)

  const tools: AgentToolset = {
    scanEngines: { obvious: obviousTransport, deepline: deeplineTransport },
    leadSource,
    email,
    crm: { write: crm.writeOpportunity },
    ads: ads.status,
  }

  const hermes = new HermesAgentRuntime()
  hermes.registerAll(activateAgents(tools, loadAllSkills(defaultSkillsRoot()), config))

  const ledger = new PgCreditLedger(exec, PRICE_CATALOG)
  await ledger.topUp(WORKSPACE, 100)
  const runs = new PgWorkflowRunStore(exec)

  await crmStore.insert({
    workspaceId: WORKSPACE,
    opportunityId: 'opp-dfw-1',
    company: 'Nordhandel GmbH',
    stage: 'qualified',
    updatedAt: '2026-11-05T00:00:00.000Z',
    version: 1,
  })

  stack = { pool, config, hermes, gate, email, crmStore, stubProvider, obviousTransport, deeplineTransport, leadSource, ads, ledger, runs }
})

let stack: E2EStack

afterAll(async () => {
  vi.restoreAllMocks()
  await stack?.pool.end()
})

// ---------------------------------------------------------------------------
// The full cycle
// ---------------------------------------------------------------------------

describe('reference customer full-cycle e2e (D5)', () => {
  it('the D3f zero-send startup guard stays armed: real provider construction is refused in test mode', () => {
    const problems = httpEmailProviderProblems({
      BLOOM_ENV: 'test',
      BLOOM_ALLOW_REAL_SENDS: '1',
      EMAIL_RELAY_URL: 'https://relay.example.com/send',
      EMAIL_RELAY_TOKEN: 'real-token',
    })
    expect(problems.some((problem) => problem.includes('test-mode'))).toBe(true)
    expect(() => createHttpEmailProvider({
      BLOOM_ENV: 'test',
      BLOOM_ALLOW_REAL_SENDS: '1',
      EMAIL_RELAY_URL: 'https://relay.example.com/send',
      EMAIL_RELAY_TOKEN: 'real-token',
    })).toThrow(/zero-send guarantee/)
  })

  it('runs the full reference-customer cycle and asserts every stage artifact', async () => {
    // ── Stage A: D2 round-trip — a fresh compile of the intake fixture must
    // reproduce the committed deployment artifact byte-for-byte. Any behavior
    // change arrives as a new config version, never a silent edit.
    const committedYaml = readFileSync(join(REPO_ROOT, 'deployments/reference/workflow.yaml'), 'utf8')
    const history = readFileSync(join(REPO_ROOT, 'deployments/reference/history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { version: number; intakeChecksum: string; yamlChecksum: string })
    const latest = must(history.at(-1), 'config history latest entry')

    const fieldMap = FieldMap.fromCsv(
      readFileSync(join(REPO_ROOT, 'templates/customer-intake/08-field-map-internal.csv'), 'utf8'),
    )
    const intake = JSON.parse(
      readFileSync(join(REPO_ROOT, 'tests/fixtures/intake/reference.intake.json'), 'utf8'),
    )
    const recompiled = compileWorkflowConfig(intake, fieldMap, {
      customer: 'display-factory-wholesale',
      version: latest.version,
    })
    expect(recompiled.yaml).toBe(committedYaml)
    expect(recompiled.intakeChecksum).toBe(latest.intakeChecksum)

    // ── Stage B: market intel — market map + purchase-signal scan through the
    // composed scan engines (Obvious primary, Deepline fallback; the fallback
    // stays untouched while the primary is healthy).
    const intel = await runStage(stack, 'revenue-intelligence', 'market-intel', {})
    expect(intel.status).toBe('succeeded')
    const intelData = intel.result?.data as {
      marketMap: { regions: string[]; keywordClusters: string[] }
      signals: readonly ScanSignal[]
    }
    expect(intelData.marketMap.regions).toEqual(stack.config.marketIntel.regions)
    expect(intelData.signals.length).toBe(DFW_SIGNALS.length)
    expect(stack.obviousTransport.queries).toEqual([
      { keywords: stack.config.marketIntel.keywords, regions: stack.config.marketIntel.regions },
    ])
    expect(stack.deeplineTransport.queries).toEqual([])
    await chargeStage(stack, 'scan-engine', 'obvious-test', DFW_SIGNALS.length)

    // ── Stage C: ICP — the intake's own criteria text becomes normalized
    // runtime weights for the internal_v1 model.
    const icp = await runStage(stack, 'icp', 'icp-tuning', {})
    expect(icp.status).toBe('succeeded')
    const icpData = icp.result?.data as { model: string; weights: Record<string, number> }
    expect(icpData.model).toBe('internal_v1')
    expect(Object.values(icpData.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10)
    await chargeStage(stack, 'icp', 'internal_v1', 1)

    // ── Stage D: lead selection — scored, tiered, quota-capped, best first.
    const lead = await runStage(stack, 'lead', 'lead-selection', {})
    expect(lead.status).toBe('succeeded')
    const leadData = lead.result?.data as {
      quota: number
      leads: readonly { company: string; contact: string; country: string; score: number; tier: string; rationale: string }[]
    }
    const scoring = must(stack.config.leadScoring, 'lead_scoring config section')
    expect(leadData.quota).toBe(scoring.monthlyQuota)
    expect(leadData.leads.length).toBe(DFW_CANDIDATES.length)
    expect(leadData.leads[0]?.company).toBe('Nordhandel GmbH')
    expect(leadData.leads[0]?.tier).toBe('A')
    for (let index = 1; index < leadData.leads.length; index += 1) {
      const current = must(leadData.leads[index], `lead ${index}`)
      const previous = must(leadData.leads[index - 1], `lead ${index - 1}`)
      expect(current.score).toBeLessThanOrEqual(previous.score) // sorted best-first
      expect(current.rationale.length).toBeGreaterThan(0) // every lead carries a match rationale
    }
    await chargeStage(stack, 'lead-source', 'mock', DFW_CANDIDATES.length)

    // ── Stage E: outreach, cycle 1 — drafts queue for review, sends blocked
    // pending approval (P0). Nothing sends.
    const outreachLeads = leadData.leads.slice(0, 3).map((entry) => ({
      company: entry.company,
      contact: entry.contact,
      score: entry.score,
      tier: entry.tier,
    }))
    const outreach1 = await runStage(stack, 'outreach', 'outreach-draft', { leads: outreachLeads })
    expect(outreach1.status).toBe('succeeded')
    const outreach1Data = outreach1.result?.data as { drafts: number; sent: number; queued: number; rejected: number }
    expect(outreach1Data.drafts).toBe(3)
    expect(outreach1Data.sent).toBe(0)
    expect(outreach1Data.rejected).toBe(3) // pending approvals, audited as revisits on re-request
    expect(stack.email.outbox.all().length).toBe(3)
    expect(stack.stubProvider.sent).toEqual([]) // zero sends before any approval
    await chargeStage(stack, 'outreach-email', 'stub', 3)

    // ── Stage F: conversion, cycle 1 — the CRM write is approval-queued too.
    const conversion1 = await runStage(stack, 'conversion', 'conversion-track', {
      opportunities: [{ opportunityId: 'opp-dfw-1', nextStage: 'opportunity' }],
    })
    expect(conversion1.status).toBe('succeeded')
    const conversion1Data = conversion1.result?.data as { written: number; rejected: number }
    expect(conversion1Data.written).toBe(0)
    expect(conversion1Data.rejected).toBe(1)
    await chargeStage(stack, 'conversion-crm', 'internal_v1', 1)

    // ── Stage G: P0 gate probe — a DIRECT send attempt through the real
    // adapter with a pending request's id is refused and audited. The zero
    // guarantee holds even when an attacker holds a request id.
    const pendingBefore = await stack.gate.listPending(WORKSPACE)
    const emailRequests = pendingBefore.filter((request) => request.action === 'email_send')
    const crmRequests = pendingBefore.filter((request) => request.action === 'crm_write')
    expect(emailRequests.length).toBe(3)
    expect(crmRequests.length).toBe(1)

    const probeDraft = must(stack.email.outbox.all()[0], 'a queued draft exists')
    const probe = await stack.email.send.execute(
      {
        to: probeDraft.to,
        subject: probeDraft.subject,
        body: probeDraft.body,
        draftId: probeDraft.draftId,
        approvalDecisionId: must(emailRequests[0], 'an email_send gate request').id,
      },
      { workspaceId: WORKSPACE, runId: 'cycle-gate-probe' },
    )
    expect(probe.ok).toBe(false)
    expect((probe as { ok: false; error: string }).error).toMatch(/pending/i)
    expect(stack.stubProvider.sent).toEqual([])

    // ── Stage H: approve through the dashboard path — the wired decide route
    // calls exactly this gate.decide on the same PG-backed store.
    const topLead = must(outreachLeads[0], 'top-scored lead')
    const firstRequest = must(
      emailRequests.find((request) => (request.payload as { to: string }).to === topLead.contact),
      `an email_send gate request for ${topLead.contact}`,
    )
    const decision = await stack.gate.decide({
      workspaceId: WORKSPACE,
      requestId: firstRequest.id,
      outcome: 'approve',
      approver: 'Li Wei (ops)',
      note: 'reference cycle — approve the top-scored A-tier draft',
    })
    expect(decision.outcome).toBe('approved')
    expect(decision.approver).toBe('Li Wei (ops)')
    expect(await stack.gate.listPending(WORKSPACE)).toHaveLength(3) // 2 email + 1 crm remain pending

    // ── Stage I: outreach, cycle 2 (the automation re-run) — the approved
    // draft sends ONCE through the real adapter to the stub provider; the
    // other two leads stay pending and send nothing.
    const outreach2 = await runStage(stack, 'outreach', 'outreach-send', { leads: outreachLeads })
    expect(outreach2.status).toBe('succeeded')
    const outreach2Data = outreach2.result?.data as { drafts: number; sent: number; queued: number; rejected: number }
    expect(outreach2Data.sent).toBe(1)
    expect(outreach2Data.rejected).toBe(2)
    expect(stack.stubProvider.sent).toHaveLength(1)
    const sent = must(stack.stubProvider.sent[0], 'one recorded send')
    const approvedDraft = must(await stack.email.outbox.get(sent.draftId), 'the approved draft')
    expect(sent.to).toBe(topLead.contact)
    expect(sent.subject).toBe(approvedDraft.subject)
    expect(sent.body).toBe(approvedDraft.body)
    expect(sent.messageId).toMatch(/^stub-msg-/)
    await chargeStage(stack, 'outreach-email', 'stub', 1)

    // ── Stage J: conversion, cycle 2 — the approved CRM write lands.
    const crmRequest = must(crmRequests[0], 'a crm_write gate request')
    await stack.gate.decide({
      workspaceId: WORKSPACE,
      requestId: crmRequest.id,
      outcome: 'approve',
      approver: 'Li Wei (ops)',
      note: 'reference cycle — advance the qualified opportunity',
    })
    const conversion2 = await runStage(stack, 'conversion', 'conversion-write', {
      opportunities: [{ opportunityId: 'opp-dfw-1', nextStage: 'opportunity' }],
    })
    expect(conversion2.status).toBe('succeeded')
    const conversion2Data = conversion2.result?.data as { written: number; rejected: number }
    expect(conversion2Data.written).toBe(1)
    const crmRecord = await stack.crmStore.get(WORKSPACE, 'opp-dfw-1')
    expect(crmRecord?.stage).toBe('opportunity')
    expect(crmRecord?.version).toBe(2)

    // ── Stage K: ads (read-only, Lead Pro) — recommendations never execute.
    const adRun = await runStage(stack, 'ad', 'ads-recommendations', {})
    expect(adRun.status).toBe('succeeded')
    const adData = adRun.result?.data as { recommendations: readonly { action: string; readOnly: boolean }[] }
    expect(adData.recommendations.length).toBeGreaterThan(0)
    for (const recommendation of adData.recommendations) {
      expect(recommendation.readOnly).toBe(true)
    }
    await chargeStage(stack, 'ads-status', 'read-only', 1)

    // ── Persistence assertions: runs, gate audit, and the credit ledger —
    // every stage artifact queryable from compose Postgres.
    const savedRuns = await stack.runs.listForWorkspace(WORKSPACE, 25)
    expect(savedRuns.length).toBe(8) // intel, icp, lead, outreach ×2, conversion ×2, ads
    for (const run of savedRuns) {
      expect(run.workspaceId).toBe(WORKSPACE)
      expect(run.status).toBe('succeeded')
      expect(run.steps.length).toBe(1)
    }

    const audit = await stack.gate.listAudit(WORKSPACE)
    expect(audit.length).toBeGreaterThan(0)
    for (const entry of audit) {
      expect(entry.workspaceId).toBe(WORKSPACE) // locked decision 11 — every audit row carries workspace_id
    }
    const events = audit.map((entry) => entry.event)
    expect(events).toContain('gate.requested')
    expect(events).toContain('gate.decision')
    expect(events).toContain('gate.authorize.allowed')
    expect(events).toContain('gate.authorize.refused') // the Stage G probe

    const reconciliation = await stack.ledger.reconcile(WORKSPACE)
    expect(reconciliation.balanced).toBe(true) // usage sums == balance delta; no unpriced call
    expect(reconciliation.usageCostSum).toBeGreaterThan(0)
    const balance = await stack.ledger.getBalance(WORKSPACE)
    expect(balance).toBeCloseTo(100 - reconciliation.usageCostSum, 6)

    // The fallback engine was never exercised — the primary stayed healthy
    // (fallback-path exercise is the weekly Layer-2 job's concern, not this cycle's).
    expect(stack.deeplineTransport.queries).toEqual([])
    expect(stack.leadSource.callCount).toBe(1) // the single lead-selection stage pulls the pool once — re-runs go through the gate, not the source
  })
})
