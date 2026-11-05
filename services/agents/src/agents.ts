import type { AgentId, AgentInterface } from '@bloom/interfaces'

/**
 * The six-agent roster (Architecture PRD §2.1, carried through spec v3.1).
 * Boundaries are the product's safety story: an agent never acts outside its
 * "does NOT do" line, and every external action crosses the approval gate.
 */
function defineAgent(id: AgentId, boundary: string): AgentInterface {
  return {
    id,
    boundary,
    run: async () => {
      throw new Error(`agent ${id} is not implemented yet (scaffold stub)`)
    },
  }
}

export const revenueIntelligenceAgent = defineAgent(
  'revenue-intelligence',
  'No outreach, no CRM writes, no execution',
)

export const icpAgent = defineAgent('icp', 'No outreach or ad execution')

export const leadAgent = defineAgent('lead', 'No auto-contact, no direct CRM updates')

export const outreachAgent = defineAgent('outreach', 'Nothing sends without a human approval decision')

export const adAgent = defineAgent('ad', 'Never spends, never modifies a live campaign in v1.0')

export const conversionAgent = defineAgent('conversion', 'No CRM record modified without sign-off')

export const AGENT_ROSTER: readonly AgentInterface[] = [
  revenueIntelligenceAgent,
  icpAgent,
  leadAgent,
  outreachAgent,
  adAgent,
  conversionAgent,
]
