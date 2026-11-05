import type { AgentContext, AgentInterface, AgentResult, SkillDefinition } from '@bloom/interfaces'
import { SCORING_MODEL, normalizeCriteriaWeights } from '../scoring/internal-v1'
import { validateSkillInput, validatedAgentResult } from './shared'

export const ICP_BOUNDARY = 'No outreach or ad execution'

export interface IcpDeps {
  readonly skill: SkillDefinition
}

/**
 * ICP — turns the customer's ICP criteria (intake sheet 06) into the internal
 * scoring model's per-customer tuning: normalized weights over product match,
 * growth signals, and decision-chain shape. Tools: none — a pure
 * config transformation. Boundary: no outreach or ad execution.
 */
export function createIcpAgent(deps: IcpDeps): AgentInterface {
  return {
    id: 'icp',
    boundary: ICP_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }
      const weights = normalizeCriteriaWeights(context.config.icp.criteria)
      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        model: SCORING_MODEL,
        weights,
      })
    },
  }
}
