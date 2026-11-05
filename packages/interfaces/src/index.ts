/**
 * Bloom's four mandatory interfaces — Agent, Workflow, Tool, Approval — plus the
 * shared ids and gate-action vocabulary (spec deliverable D3).
 *
 * These contracts are the v2.0 compatibility plan: Mastra swaps in behind
 * AgentInterface, so v1.0 code depends on the interface, never the framework.
 */

/** The six-agent roster (Architecture PRD §2.1). */
export const AGENT_IDS = [
  'revenue-intelligence',
  'icp',
  'lead',
  'outreach',
  'ad',
  'conversion',
] as const

export type AgentId = (typeof AGENT_IDS)[number]

/**
 * Approval-gated actions. These are hard invariants: enforced in code and
 * CI-tested in every version, v1.0 and v2.0 alike — never config-off
 * (spec locked decision 10).
 */
export const GATE_ACTIONS = [
  'email_send',
  'crm_write',
  'ad_budget_change',
  'bulk_scan',
  'large_export',
  'high_cost_model_call',
  'connect_customer_production',
] as const

export type GateAction = (typeof GATE_ACTIONS)[number]

export interface ApprovalRequest {
  action: GateAction
  /** Human-readable reason the gate is being hit; lands in the audit trail. */
  reason: string
  payload?: unknown
}

export interface ApprovalDecision {
  action: GateAction
  approved: boolean
  /** Who decided — a named approver from the intake contract, never a role placeholder. */
  approver: string
  decidedAt: string
  note?: string
}

/** Every external action passes through a recorded human decision before execution. */
export interface ApprovalInterface {
  request(request: ApprovalRequest): Promise<ApprovalDecision>
}

export interface ToolContext {
  /** workspace_id travels with every context and every table from day one (spec locked decision 11). */
  workspaceId: string
}

export interface ToolInterface {
  name: string
  description: string
  execute(input: unknown, context: ToolContext): Promise<unknown>
}

export interface AgentContext {
  workspaceId: string
  input: unknown
  /** Approval gate handle — agents must route gate actions through it. */
  approvals: ApprovalInterface
}

export interface AgentResult {
  status: 'ok' | 'error'
  data?: unknown
  error?: string
}

export interface AgentInterface {
  readonly id: AgentId
  /** The agent's hard boundary — its "does NOT do" line from the Architecture PRD. */
  readonly boundary: string
  run(context: AgentContext): Promise<AgentResult>
}

export interface WorkflowStep {
  id: string
  agentId: AgentId
  /** Gate actions this step may hit; enforced by the approval service, not the agent. */
  gateActions?: GateAction[]
}

export interface WorkflowDefinition {
  id: string
  steps: WorkflowStep[]
}

export interface WorkflowInterface {
  readonly id: string
  execute(definition: WorkflowDefinition, context: AgentContext): Promise<AgentResult>
}
