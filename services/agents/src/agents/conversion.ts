import type { AgentContext, AgentInterface, AgentResult, SkillDefinition } from '@bloom/interfaces'
import type { CrmTools } from '../tools/shapes'
import { toolContext, validateSkillInput, validatedAgentResult } from './shared'

export const CONVERSION_BOUNDARY = 'No CRM record modified without sign-off'

export interface ConversionDeps {
  readonly skill: SkillDefinition
  readonly crm: CrmTools
}

interface OpportunityInput {
  readonly opportunityId: string
  readonly nextStage: string
}

function isOpportunity(value: unknown): value is OpportunityInput {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const opportunity = value as { opportunityId?: unknown; nextStage?: unknown }
  return typeof opportunity.opportunityId === 'string' && typeof opportunity.nextStage === 'string'
}

/**
 * Conversion — tracks opportunities in the customer's CRM and advances
 * stages, attributing closed revenue back to the originating signal. Every
 * CRM write crosses the crm_write gate; the write tool structurally requires
 * the decision id. Boundary: no CRM record modified without sign-off.
 */
export function createConversionAgent(deps: ConversionDeps): AgentInterface {
  return {
    id: 'conversion',
    boundary: CONVERSION_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }

      const input = context.input as { opportunities?: unknown }
      const opportunities = input.opportunities
      if (!Array.isArray(opportunities) || !opportunities.every(isOpportunity)) {
        return {
          status: 'error',
          error: 'conversion input requires an opportunities array of { opportunityId, nextStage }',
        }
      }

      let written = 0
      let rejected = 0
      const rejectedIds: string[] = []

      for (const opportunity of opportunities) {
        const decision = await context.approvals.request({
          action: 'crm_write',
          requestedBy: 'conversion',
          reason: `advance ${opportunity.opportunityId} to ${opportunity.nextStage}`,
          skill: { name: deps.skill.name, version: deps.skill.version },
          payload: { opportunityId: opportunity.opportunityId, nextStage: opportunity.nextStage },
        })
        if (!decision.approved) {
          rejected += 1
          rejectedIds.push(opportunity.opportunityId)
          continue
        }
        const result = await deps.crm.write.execute(
          {
            opportunityId: opportunity.opportunityId,
            // Field name matches the real CRM-write adapter's schema and its
            // gate binding ({ opportunityId, nextStage }); `stage` would
            // authorize a binding mismatch and refuse the write.
            nextStage: opportunity.nextStage,
            approvalDecisionId: decision.decisionId,
            // No caller `approver` — the adapter takes it from the verified
            // gate decision (same rule as the email adapter).
          },
          toolContext(context),
        )
        if (!result.ok) {
          return { status: 'error', error: result.error }
        }
        written += 1
      }

      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        written,
        rejected,
        ...(rejectedIds.length > 0 ? { rejectedIds } : {}),
      })
    },
  }
}
