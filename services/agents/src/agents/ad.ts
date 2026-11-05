import type { AgentContext, AgentInterface, AgentResult, SkillDefinition, ToolInterface } from '@bloom/interfaces'
import type { MockCampaign } from '../tools/mocks'
import { toolContext, validateSkillInput, validatedAgentResult } from './shared'

export const AD_BOUNDARY = 'Never spends, never modifies a live campaign in v1.0'

export interface AdDeps {
  readonly skill: SkillDefinition
  /** Read-only status tool — no mutating tool exists on the ads adapter. */
  readonly ads: ToolInterface
}

export interface AdRecommendation {
  readonly workspaceId: string
  readonly platform: string
  readonly campaignId: string
  readonly action: string
  readonly rationale: string
  readonly readOnly: true
}

interface CampaignRecommendation {
  readonly action: string
  readonly rationale: string
}

/** Read-only pacing rules — pure, deterministic, never an executed change. */
export function adRecommendations(campaign: MockCampaign): readonly CampaignRecommendation[] {
  const recommendations: CampaignRecommendation[] = []
  if (campaign.budgetMonthly > 0 && campaign.spendMtd / campaign.budgetMonthly >= 0.9) {
    recommendations.push({
      action: 'review_budget',
      rationale: `${Math.round((campaign.spendMtd / campaign.budgetMonthly) * 100)}% of the monthly budget spent — recommend a human budget review`,
    })
  }
  if (campaign.status === 'limited') {
    recommendations.push({
      action: 'refresh_creative',
      rationale: 'delivery limited by the platform — recommend creative refresh',
    })
  }
  return recommendations
}

function isCampaign(value: unknown): value is MockCampaign {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const campaign = value as Record<string, unknown>
  return (
    typeof campaign.platform === 'string' &&
    typeof campaign.campaignId === 'string' &&
    typeof campaign.name === 'string' &&
    typeof campaign.status === 'string' &&
    typeof campaign.budgetMonthly === 'number' &&
    typeof campaign.spendMtd === 'number'
  )
}

/**
 * Ad — read-only Google Ads and LinkedIn Ads status plus campaign
 * recommendations (spec locked decision 6). Boundary: never spends, never
 * modifies a live campaign in v1.0 — the adapter exposes no mutating tool at all.
 */
export function createAdAgent(deps: AdDeps): AgentInterface {
  return {
    id: 'ad',
    boundary: AD_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }

      const ads = context.config.ads
      if (!ads) {
        return {
          status: 'error',
          error: 'ad agent requires the ads config block (optional per intake)',
        }
      }

      const input = context.input as { platforms?: unknown }
      let requested: readonly string[] = [...ads.platforms]
      if (input.platforms !== undefined) {
        if (!Array.isArray(input.platforms) || !input.platforms.every((platform) => typeof platform === 'string')) {
          return { status: 'error', error: 'input platforms must be an array of platform names' }
        }
        requested = input.platforms as string[]
      }

      const unsupported = requested.filter((platform) => !(ads.platforms as readonly string[]).includes(platform))
      if (unsupported.length > 0) {
        return {
          status: 'error',
          error: `platforms outside the contract: ${unsupported.join(', ')} — only ${ads.platforms.join(' and ')} are supported`,
        }
      }

      const recommendations: AdRecommendation[] = []
      for (const platform of requested) {
        const result = await deps.ads.execute({ platform }, toolContext(context))
        if (!result.ok) {
          return { status: 'error', error: result.error }
        }
        const campaigns = (result.data as { campaigns?: unknown }).campaigns
        if (!Array.isArray(campaigns) || !campaigns.every(isCampaign)) {
          return { status: 'error', error: `ads status returned malformed campaigns for ${platform}` }
        }
        for (const campaign of campaigns) {
          for (const recommendation of adRecommendations(campaign)) {
            recommendations.push({
              workspaceId: context.workspaceId,
              platform: campaign.platform,
              campaignId: campaign.campaignId,
              action: recommendation.action,
              rationale: recommendation.rationale,
              readOnly: true,
            })
          }
        }
      }

      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        recommendations,
      })
    },
  }
}
