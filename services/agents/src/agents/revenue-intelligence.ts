import type {
  AgentContext,
  AgentInterface,
  AgentResult,
  ScanEngineInterface,
  SkillDefinition,
} from '@bloom/interfaces'
import { validateSkillInput, validatedAgentResult } from './shared'

export const REVENUE_INTELLIGENCE_BOUNDARY = 'No outreach, no CRM writes, no execution'

export interface RevenueIntelligenceDeps {
  readonly skill: SkillDefinition
  /** Already-composed engine chain (config-driven primary + fallback). */
  readonly scanEngine: ScanEngineInterface
}

/**
 * Revenue Intelligence — market map, competitor scan, keyword/intent clusters,
 * and the weekly purchase-signal scan that powers the monthly brief (module A)
 * and quarterly trends (module C). Tools: scan-engine adapter. Boundary:
 * no outreach, no CRM writes, no execution.
 */
export function createRevenueIntelligenceAgent(deps: RevenueIntelligenceDeps): AgentInterface {
  return {
    id: 'revenue-intelligence',
    boundary: REVENUE_INTELLIGENCE_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }

      const requested = context.input as { bulk?: unknown }
      if (requested.bulk === true) {
        const decision = await context.approvals.request({
          action: 'bulk_scan',
          requestedBy: 'revenue-intelligence',
          reason: 'scan requested beyond the scheduled purchase-signal scope',
          skill: { name: deps.skill.name, version: deps.skill.version },
        })
        if (!decision.approved) {
          return {
            status: 'error',
            error: `bulk scan rejected by approver ${decision.approver} (decision ${decision.decisionId})`,
          }
        }
      }

      const config = context.config
      const signals = await deps.scanEngine.scan({
        keywords: [...config.marketIntel.keywords],
        regions: [...config.marketIntel.regions],
      })
      const capped = signals.slice(0, config.purchaseSignals.maxSignalsPerPeriod)

      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        marketMap: {
          regions: [...config.marketIntel.regions],
          keywordClusters: [...config.marketIntel.keywords],
        },
        signals: capped.map((signal) => ({ ...signal, workspaceId: context.workspaceId })),
      })
    },
  }
}
