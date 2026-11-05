import { readFileSync } from 'node:fs'
import type {
  AgentContext,
  AgentId,
  AgentInterface,
  ApprovalDecision,
  ApprovalInterface,
  ApprovalRequest,
  SkillDefinition,
  WorkflowConfig,
} from '@bloom/interfaces'
import { workflowConfigProblems } from '@bloom/interfaces'
import { loadAllSkills, defaultSkillsRoot } from '../skills/loader'
import {
  activateAgents,
  skillFor,
  type AgentToolset,
} from '../roster'
import type { MockScanEngine, MockEmailAdapter, MockCrmAdapter } from '../tools/mocks'
import {
  createMockAdsAdapter,
  createMockCrmAdapter,
  createMockEmailAdapter,
  createMockLeadSourceTool,
  createMockScanEngine,
  type MockCandidate,
  type MockCampaign,
} from '../tools/mocks'

/**
 * Test harness: deterministic mocks, an in-memory approval gate with recorded
 * decisions, and the reference workflow config fixture. The fixture mirrors
 * the compiled-config shape the intake compiler (services/config) emits for
 * the reference customer; tests mutate it to prove behavior is config-driven.
 */

export function referenceConfig(): WorkflowConfig {
  const path = new URL('./reference-workflow.config.json', import.meta.url)
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowConfig
}

/** Deep-writable view of a config — parameterization tests mutate the copy, never the readonly contract. */
export type DeepWritable<T> = T extends readonly (infer U)[]
  ? DeepWritable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
    : T

/** Deep-clones the reference config and applies a mutation — the "config change" in parameterization tests. */
export function mutatedConfig(mutate: (draft: DeepWritable<WorkflowConfig>) => void): WorkflowConfig {
  const config = structuredClone(referenceConfig()) as DeepWritable<WorkflowConfig>
  mutate(config)
  const problems = workflowConfigProblems(config)
  if (problems.length > 0) {
    throw new Error(`mutated fixture config is invalid: ${problems.join('; ')}`)
  }
  return config
}

/**
 * In-memory approval gate. The decider decides per gate action (default:
 * approve everything); every request and decision is recorded for audit
 * assertions.
 */
export class MemoryApproval implements ApprovalInterface {
  readonly requests: ApprovalRequest[] = []
  readonly decisions: ApprovalDecision[] = []

  constructor(private readonly decider: (action: ApprovalRequest['action']) => boolean = () => true) {}

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.requests.push(request)
    const decision: ApprovalDecision = {
      decisionId: `dec-${this.decisions.length + 1}`,
      action: request.action,
      approved: this.decider(request.action),
      approver: 'fixture-approver',
      decidedAt: '2026-01-01T00:00:00.000Z',
    }
    this.decisions.push(decision)
    return decision
  }
}

export const FIXTURE_CANDIDATES: readonly MockCandidate[] = [
  {
    company: 'Aurora Exhibits',
    contact: 'ops@aurora-exhibits.example',
    country: 'United States',
    signals: { product_fit: 0.9, growth_signal: 0.8, decision_chain: 0.7 },
  },
  {
    company: 'Cascadia Events',
    contact: 'hello@cascadia-events.example',
    country: 'United States',
    signals: { product_fit: 0.5, growth_signal: 0.9, decision_chain: 0.4 },
  },
  {
    company: 'NordMed Messe',
    contact: 'sales@nordmed-messe.example',
    country: 'Germany',
    signals: { product_fit: 0.7, growth_signal: 0.4, decision_chain: 0.6 },
  },
  {
    company: 'Iberia Ferias',
    contact: 'contact@iberia-ferias.example',
    country: 'Spain',
    signals: { product_fit: 0.6, growth_signal: 0.2, decision_chain: 0.5 },
  },
  {
    company: 'Baltic Expo Group',
    contact: 'info@baltic-expo.example',
    country: 'Estonia',
    signals: { product_fit: 0.4, growth_signal: 0.6, decision_chain: 0.3 },
  },
  {
    company: 'Pacific Rim Trading',
    contact: 'desk@pacific-rim.example',
    country: 'Singapore',
    signals: { product_fit: 0.2, growth_signal: 0.1, decision_chain: 0.9 },
  },
]

const OBVIOUS_SIGNALS = [
  { title: 'Expo organizer expanding booth procurement', url: 'https://example.com/rfp', source: 'obvious' as const },
  { title: 'US venue reports exhibitor growth', url: 'https://example.com/growth', source: 'obvious' as const },
  { title: 'European fair calendar extended', url: 'https://example.com/calendar', source: 'obvious' as const },
]

const DEEPLINE_SIGNALS = [
  { title: 'Deepline: stand builder procurement notice', url: 'https://example.com/deepline', source: 'deepline' as const },
]

export const FIXTURE_CAMPAIGNS: readonly MockCampaign[] = [
  {
    platform: 'google',
    campaignId: 'g-1',
    name: 'Booth hardware — US',
    status: 'enabled',
    budgetMonthly: 1000,
    spendMtd: 950,
  },
  {
    platform: 'linkedin',
    campaignId: 'li-1',
    name: 'Trade fair decision makers',
    status: 'limited',
    budgetMonthly: 500,
    spendMtd: 100,
  },
]

export interface TestStack {
  readonly toolset: AgentToolset
  readonly email: MockEmailAdapter
  readonly crm: MockCrmAdapter
  readonly engines: {
    readonly obvious: MockScanEngine
    readonly deepline: MockScanEngine
  }
  readonly agents: readonly AgentInterface[]
}

/** Wires the full mock stack and activates the roster for a config — one call per test. */
export function buildStack(config: WorkflowConfig, candidates: readonly MockCandidate[] = FIXTURE_CANDIDATES): TestStack {
  const engines = {
    obvious: createMockScanEngine('obvious', OBVIOUS_SIGNALS),
    deepline: createMockScanEngine('deepline', DEEPLINE_SIGNALS),
  }
  const leadSource = createMockLeadSourceTool(candidates)
  const email = createMockEmailAdapter()
  const crm = createMockCrmAdapter()
  const ads = createMockAdsAdapter(FIXTURE_CAMPAIGNS)
  const toolset: AgentToolset = {
    scanEngines: engines,
    leadSource,
    email,
    crm,
    ads: ads.status,
  }
  return { toolset, email, crm, engines, agents: activateAgents(toolset, loadAllSkills(defaultSkillsRoot()), config) }
}

export function agentById(stack: TestStack, id: string): AgentInterface {
  const agent = stack.agents.find((candidate) => candidate.id === id)
  if (!agent) {
    throw new Error(`agent ${id} not activated for this config`)
  }
  return agent
}

export function skillById(agentId: AgentId): SkillDefinition {
  return skillFor(loadAllSkills(defaultSkillsRoot()), agentId)
}

export function makeContext(config: WorkflowConfig, input: unknown, approvals: ApprovalInterface): AgentContext {
  return {
    workspaceId: config.workspaceId,
    input,
    approvals,
    config,
    runId: 'run-test',
  }
}

export { OBVIOUS_SIGNALS, DEEPLINE_SIGNALS }
