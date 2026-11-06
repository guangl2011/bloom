/**
 * Live-stack reference-customer cycle runner (spec D5 against a RUNNING stack).
 *
 * The vitest e2e (reference-customer.test.ts) runs the same cycle in-process;
 * this runner executes it against the live compose deployment and uses REAL
 * HTTP at the only place a human touches the system: the approval decision
 * goes over the wire to the running web dashboard's /api/approvals/decide
 * route, which persists it through the same PG-backed, audit-logged gate.
 *
 * Mocks live ONLY at the network transport seam (scan engines, lead source,
 * email provider) — identical to the vitest e2e. Zero external sends.
 *
 *   DATABASE_URL=postgres://bloom:bloom@localhost:5432/bloom \
 *   pnpm exec tsx tests/e2e/live-cycle-runner.ts <pre|post>
 *
 * `pre`  — config round-trip + stages A–G: pipeline runs, P0 gate requests
 *          queue pending, a direct send attempt is refused. Print the pending
 *          requests as JSON (consumed by the dashboard evidence flow).
 * `post` — approve the top-lead email and the CRM write over HTTP to the
 *          RUNNING dashboard, re-run outreach/conversion (send executes once),
 *          ads stage, then assert runs / audit / credit reconciliation and
 *          print the cycle summary.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'
import { createPgExecutorFromUrl, loadMigrations, MigrationRunner } from '@bloom/db'
import { parseWorkflowConfig, runtimeConfigFromCompiled } from '@bloom/svc-config'
import { activateAgents, type AgentToolset } from '@bloom/svc-agents/roster'
import { HermesAgentRuntime, type AgentRunRecord } from '@bloom/svc-agents/hermes'
import { defaultSkillsRoot, loadAllSkills } from '@bloom/svc-agents/skills'
import { createMockAdsAdapter, createMockLeadSourceTool, type MockCampaign, type MockCandidate } from '@bloom/svc-agents/tools'
import { createApprovalGate, type ApprovalGate, type GateRequestRecord } from '@bloom/svc-approval/gate'
import { PgApprovalStore } from '@bloom/svc-approval/store-pg'
import { createCrmAdapter, InMemoryCrmStore } from '@bloom/adapter-crm'
import { createEmailAdapter, createStubEmailProvider } from '@bloom/adapter-email'
import { PgCreditLedger } from '@bloom/svc-credits/ledger-pg'
import { PgWorkflowRunStore } from '@bloom/svc-workflow/runs-pg'
import type { AgentContext, AgentId, ScanEngineId, ScanEngineInterface, ScanQuery, ScanSignal, WorkflowConfig } from '@bloom/interfaces'

const REPO_ROOT = process.cwd()
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://bloom:bloom@localhost:5432/bloom'
const DASHBOARD_URL = process.env.BLOOM_DASHBOARD_URL ?? 'http://127.0.0.1:3000'
const WORKSPACE = process.env.BLOOM_LIVE_WORKSPACE ?? `dfw-live-${Date.now()}`
const phase = process.argv[2] ?? 'pre'
assert(phase === 'pre' || phase === 'post', 'usage: live-cycle-runner.ts <pre|post>')

const PRICE_CATALOG: Record<string, number> = {
  'scan-engine': 0.5,
  'scan-engine:obvious-test': 0.4,
  'icp': 0.1,
  'lead-source': 0.2,
  'outreach-email': 0.05,
  'conversion-crm': 0.05,
  'ads-status': 0.01,
}

// --- reference-customer fixtures (same transport-seam canned externals as the vitest e2e) ---

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
  { company: 'Nordhandel GmbH', contact: 'einkauf@nordhandel.example', country: 'DE', signals: { product_fit: 0.92, growth_signal: 0.85, decision_chain: 0.78 } },
  { company: 'Bloemen Markt BV', contact: 'inkoop@bloemenmarkt.example', country: 'NL', signals: { product_fit: 0.86, growth_signal: 0.7, decision_chain: 0.62 } },
  { company: 'Malmö Butiks AB', contact: 'inkop@malmo-butiks.example', country: 'SE', signals: { product_fit: 0.7, growth_signal: 0.66, decision_chain: 0.52 } },
  { company: 'Bałtyk Sklep Sp. z o.o.', contact: 'zakupy@baltysklep.example', country: 'PL', signals: { product_fit: 0.58, growth_signal: 0.55, decision_chain: 0.4 } },
]

const DFW_CAMPAIGNS: readonly MockCampaign[] = [
  { platform: 'google', campaignId: 'g-1', name: 'DE display shelving', status: 'active', budgetMonthly: 1000, spendMtd: 950 },
  { platform: 'linkedin', campaignId: 'li-1', name: 'EU retail buyers', status: 'limited', budgetMonthly: 800, spendMtd: 300 },
]

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
      if (failure !== undefined) throw new Error(failure)
      return [...signals]
    },
  }
}

function must<T>(value: T | undefined, what: string): T {
  assert(value !== undefined, `live-cycle invariant broken: ${what}`)
  return value
}

// --- stack (constructed in main once the executor exists) ---

interface LiveStack {
  gate: ApprovalGate
  email: ReturnType<typeof createEmailAdapter>
  stubProvider: ReturnType<typeof createStubEmailProvider>
  crmStore: InMemoryCrmStore
  crm: ReturnType<typeof createCrmAdapter>
  obviousTransport: TestTransport
  deeplineTransport: TestTransport
  hermes: HermesAgentRuntime
  ledger: PgCreditLedger
  runs: PgWorkflowRunStore
  config: WorkflowConfig
}

async function buildStack(): Promise<LiveStack> {
  const { exec } = createPgExecutorFromUrl(DATABASE_URL)
  const migrations = await loadMigrations(join(REPO_ROOT, 'packages/db/migrations'))
  await new MigrationRunner((sql) => exec(sql)).run(migrations)

  const store = new PgApprovalStore(exec)
  const gate = createApprovalGate({ store })
  const stubProvider = createStubEmailProvider()
  const email = createEmailAdapter({ gate, provider: stubProvider })
  const crmStore = new InMemoryCrmStore()
  const crm = createCrmAdapter({ gate, store: crmStore })
  const obviousTransport = testTransport('obvious', DFW_SIGNALS)
  const deeplineTransport = testTransport('deepline', [], 'deepline must not be called while the primary is healthy')
  const leadSource = createMockLeadSourceTool(DFW_CANDIDATES)
  const ads = createMockAdsAdapter(DFW_CAMPAIGNS)

  // The committed deployment artifact IS the reference customer's config.
  const committedYaml = readFileSync(join(REPO_ROOT, 'deployments/reference/workflow.yaml'), 'utf8')
  const compiled = parseWorkflowConfig(committedYaml)
  const config = runtimeConfigFromCompiled(compiled, { workspaceId: WORKSPACE })

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

  return { store, gate, email, stubProvider, crmStore, crm, obviousTransport, deeplineTransport, hermes, ledger, runs, config }
}

async function runStage(stack: LiveStack, agentId: AgentId, stage: string, input: unknown): Promise<AgentRunRecord> {
  const context: AgentContext = {
    workspaceId: WORKSPACE,
    input,
    approvals: stack.gate.asApprovalInterface(WORKSPACE),
    config: stack.config,
    runId: `live-cycle-${stage}`,
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
    steps: [{
      stepId: stage,
      agentId: record.agentId,
      status: record.status === 'succeeded' ? 'succeeded' : 'failed',
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      ...(record.error === undefined ? {} : { error: record.error }),
    }],
    result: record.result,
  })
  return record
}

async function chargeStage(stack: LiveStack, tool: string, model: string, units: number): Promise<void> {
  await stack.ledger.recordUsage(WORKSPACE, { tool, model, units })
}

/** The human touchpoint: the decision goes over REAL HTTP to the RUNNING dashboard. */
async function decideViaDashboard(requestId: string, approved: boolean, approver: string, note: string): Promise<{ id: string; approved: boolean; via: string }> {
  const response = await fetch(`${DASHBOARD_URL}/api/approvals/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: requestId, approved, approver, note }),
  })
  assert(response.ok, `dashboard decide route returned ${response.status} for ${requestId}`)
  return (await response.json()) as { id: string; approved: boolean; via: string }
}

interface PendingSnapshot {
  workspace: string
  pending: { id: string; action: string; payload: Record<string, unknown> }[]
}

async function pendingSnapshot(stack: LiveStack): Promise<PendingSnapshot> {
  const requests = await stack.gate.listPending(WORKSPACE)
  return {
    workspace: WORKSPACE,
    pending: requests.map((request: GateRequestRecord) => ({ id: request.id, action: request.action, payload: request.payload as Record<string, unknown> })),
  }
}

// --- phases ---

async function pre(): Promise<void> {
  const stack = await buildStack()

  // Stage A — the committed deployment artifact compiles from the intake fixture.
  const committedYaml = readFileSync(join(REPO_ROOT, 'deployments/reference/workflow.yaml'), 'utf8')
  const history = readFileSync(join(REPO_ROOT, 'deployments/reference/history.jsonl'), 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line) as { version: number; intakeChecksum: string; yamlChecksum: string })
  const latest = must(history.at(-1), 'config history latest entry')
  const { compileWorkflowConfig, FieldMap } = await import('@bloom/svc-config')
  const fieldMap = FieldMap.fromCsv(readFileSync(join(REPO_ROOT, 'templates/customer-intake/08-field-map-internal.csv'), 'utf8'))
  const intake = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/intake/reference.intake.json'), 'utf8'))
  const recompiled = compileWorkflowConfig(intake, fieldMap, { customer: 'display-factory-wholesale', version: latest.version })
  assert.equal(recompiled.yaml, committedYaml, 'recompiled config must be byte-equal to the committed artifact')
  assert.equal(recompiled.intakeChecksum, latest.intakeChecksum)

  // Stage B — market intel: market map + purchase-signal scan, Obvious primary.
  const intel = await runStage(stack, 'revenue-intelligence', 'market-intel', {})
  assert.equal(intel.status, 'succeeded')
  assert.equal(must(stack.obviousTransport.queries[0], 'obvious query').keywords.length > 0, true)
  assert.equal(stack.deeplineTransport.queries.length, 0)
  await chargeStage(stack, 'scan-engine', 'obvious-test', DFW_SIGNALS.length)

  // Stage C — ICP tuning from the intake's own criteria.
  const icp = await runStage(stack, 'icp', 'icp-tuning', {})
  assert.equal(icp.status, 'succeeded')
  await chargeStage(stack, 'icp', 'internal_v1', 1)

  // Stage D — lead selection: scored, tiered, quota-capped.
  const lead = await runStage(stack, 'lead', 'lead-selection', {})
  assert.equal(lead.status, 'succeeded')
  const leadData = must(lead.result?.data, 'lead result') as { quota: number; leads: { company: string; contact: string; score: number; tier: string }[] }
  assert.equal(leadData.leads[0]?.company, 'Nordhandel GmbH')
  assert.equal(leadData.leads[0]?.tier, 'A')
  await chargeStage(stack, 'lead-source', 'mock', DFW_CANDIDATES.length)

  // Stage E — outreach drafts queue; sends blocked pending approval (P0).
  const outreachLeads = leadData.leads.slice(0, 3).map((entry) => ({ company: entry.company, contact: entry.contact, score: entry.score, tier: entry.tier }))
  const outreach1 = await runStage(stack, 'outreach', 'outreach-draft', { leads: outreachLeads })
  assert.equal(outreach1.status, 'succeeded')
  const outreach1Data = must(outreach1.result?.data, 'outreach result') as { drafts: number; sent: number }
  assert.equal(outreach1Data.drafts, 3)
  assert.equal(outreach1Data.sent, 0)
  assert.equal(stack.stubProvider.sent.length, 0, 'zero sends before any approval')
  await chargeStage(stack, 'outreach-email', 'stub', 3)

  // Stage F — conversion CRM write queued too.
  const conversion1 = await runStage(stack, 'conversion', 'conversion-track', { opportunities: [{ opportunityId: 'opp-dfw-1', nextStage: 'opportunity' }] })
  assert.equal(conversion1.status, 'succeeded')
  await chargeStage(stack, 'conversion-crm', 'internal_v1', 1)

  // Stage G — P0 gate probe: direct send with a pending request id is refused.
  const snapshot = await pendingSnapshot(stack)
  const emailRequests = snapshot.pending.filter((request) => request.action === 'email_send')
  assert.equal(emailRequests.length, 3, 'three email_send gate requests pending')
  assert.equal(snapshot.pending.filter((request) => request.action === 'crm_write').length, 1, 'one crm_write gate request pending')
  const probeDraft = must(stack.email.outbox.all()[0], 'a queued draft exists')
  const probe = await stack.email.send.execute(
    { to: probeDraft.to, subject: probeDraft.subject, body: probeDraft.body, draftId: probeDraft.draftId, approvalDecisionId: must(emailRequests[0], 'an email_send request').id },
    { workspaceId: WORKSPACE, runId: 'live-cycle-gate-probe' },
  )
  assert.equal(probe.ok, false, 'send with a pending approval must be refused')
  assert.equal(stack.stubProvider.sent.length, 0)

  writeFileSync('/tmp/bloom-live-pre.json', JSON.stringify({ ...snapshot, topLeadContact: outreachLeads[0]?.contact }, null, 2))
  console.log(JSON.stringify({ phase: 'pre', workspace: WORKSPACE, pending: snapshot.pending.length, gateProbe: 'refused-and-audited' }))
}

async function post(): Promise<void> {
  const stack = await buildStack()

  // The top-lead email decision may already have been recorded through the
  // dashboard UI (the browser evidence flow clicks the same decide route).
  // Either path is a real HTTP decision through the running dashboard; what
  // the P0 gate requires is a recorded human decision — never a library call.
  const allRequests = await stack.store.allRequests()
  const topLeadRequest = must(
    allRequests.find((request) => request.action === 'email_send' && (request.payload as { to?: string }).to === 'einkauf@nordhandel.example'),
    'the email_send request for the top lead',
  )
  const emailAlreadyDecided = topLeadRequest.state !== 'pending'
  const pendingBefore = (await stack.gate.listPending(WORKSPACE)).length
  assert.equal(pendingBefore, emailAlreadyDecided ? 3 : 4, 'pre-phase gate requests are intact')
  let decisionVia = 'dashboard-ui'
  if (!emailAlreadyDecided) {
    const decision = await decideViaDashboard(topLeadRequest.id, true, 'Li Wei (ops)', 'live cycle — approve the top-scored A-tier draft')
    decisionVia = decision.via
  }
  assert.equal((await stack.gate.listPending(WORKSPACE)).length, 3, '3 requests remain pending after the email approval')

  const topLeadContact = 'einkauf@nordhandel.example'

  // Stage I — outreach re-run: exactly ONE send executes through the adapter.
  const savedLeadRun = must((await stack.runs.listForWorkspace(WORKSPACE, 25)).find((run) => run.workflowId.endsWith('lead-selection')), 'saved lead-selection run')
  const leadData = (savedLeadRun.result as { data: { leads: { company: string; contact: string; score: number; tier: string }[] } }).data.leads.slice(0, 3)
  const outreach2 = await runStage(stack, 'outreach', 'outreach-send', { leads: leadData })
  assert.equal(outreach2.status, 'succeeded')
  const outreach2Data = must(outreach2.result?.data, 'outreach send result') as { sent: number; rejected: number }
  assert.equal(outreach2Data.sent, 1, 'exactly one approved draft sends')
  assert.equal(outreach2Data.rejected, 2)
  assert.equal(stack.stubProvider.sent.length, 1)
  assert.equal(must(stack.stubProvider.sent[0], 'the recorded send').to, topLeadContact)
  await chargeStage(stack, 'outreach-email', 'stub', 1)

  // Stage J — CRM approval over HTTP, then the write lands.
  const crmRequest = must(
    (await stack.gate.listPending(WORKSPACE)).find((request) => request.action === 'crm_write'),
    'the crm_write request',
  )
  await decideViaDashboard(crmRequest.id, true, 'Li Wei (ops)', 'live cycle — advance the qualified opportunity')
  const conversion2 = await runStage(stack, 'conversion', 'conversion-write', { opportunities: [{ opportunityId: 'opp-dfw-1', nextStage: 'opportunity' }] })
  assert.equal(conversion2.status, 'succeeded')
  const crmRecord = await stack.crmStore.get(WORKSPACE, 'opp-dfw-1')
  assert.equal(crmRecord?.stage, 'opportunity')
  assert.equal(crmRecord?.version, 2)

  // Stage K — ads (read-only, Lead Pro).
  const adRun = await runStage(stack, 'ad', 'ads-recommendations', {})
  assert.equal(adRun.status, 'succeeded')
  await chargeStage(stack, 'ads-status', 'read-only', 1)

  // Persistence + accounting assertions against the live database.
  const savedRuns = await stack.runs.listForWorkspace(WORKSPACE, 25)
  assert.equal(savedRuns.length, 8, 'eight persisted workflow runs')
  const audit = await stack.gate.listAudit(WORKSPACE)
  const events = audit.map((entry) => entry.event)
  for (const expected of ['gate.requested', 'gate.decision', 'gate.authorize.allowed', 'gate.authorize.refused']) {
    assert(events.includes(expected), `audit trail must contain ${expected}`)
  }
  const reconciliation = await stack.ledger.reconcile(WORKSPACE)
  assert.equal(reconciliation.balanced, true, 'credit ledger must reconcile')
  const balance = await stack.ledger.getBalance(WORKSPACE)

  console.log(JSON.stringify({
    phase: 'post',
    workspace: WORKSPACE,
    decisionVia: decisionVia,
    emailsSent: stack.stubProvider.sent.length,
    crmStage: crmRecord?.stage,
    persistedRuns: savedRuns.length,
    auditEvents: audit.length,
    credits: { usageCostSum: reconciliation.usageCostSum, balance },
  }, null, 2))
}

await (phase === 'pre' ? pre() : post())
process.exit(0) // pg pools stay open; an explicit end keeps the runner snappy
