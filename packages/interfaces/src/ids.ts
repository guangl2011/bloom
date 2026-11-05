/**
 * The six-agent roster and the gate-action vocabulary (Architecture PRD §2.1,
 * carried through spec v3.1).
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

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value)
}

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
