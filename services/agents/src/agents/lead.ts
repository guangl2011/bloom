import type { AgentContext, AgentInterface, AgentResult, SkillDefinition, ToolInterface } from '@bloom/interfaces'
import type { MockCandidate } from '../tools/mocks'
import {
  scoreLead,
  scoreRationale,
  tierForScore,
  normalizeCriteriaWeights,
  type LeadTier,
  type ScoringTuning,
} from '../scoring/internal-v1'
import { toolContext, validateSkillInput, validatedAgentResult } from './shared'

export const LEAD_BOUNDARY = 'No auto-contact, no direct CRM updates'

export interface LeadDeps {
  readonly skill: SkillDefinition
  readonly leadSource: ToolInterface
}

export interface ScoredLead {
  readonly workspaceId: string
  readonly company: string
  readonly contact: string
  readonly country: string
  readonly score: number
  readonly tier: LeadTier
  readonly rationale: string
}

function isCandidate(value: unknown): value is MockCandidate {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as { company?: unknown; contact?: unknown; country?: unknown; signals?: unknown }
  return (
    typeof candidate.company === 'string' &&
    typeof candidate.contact === 'string' &&
    typeof candidate.country === 'string' &&
    candidate.signals !== null &&
    typeof candidate.signals === 'object' &&
    !Array.isArray(candidate.signals) &&
    Object.values(candidate.signals).every((strength) => typeof strength === 'number' && Number.isFinite(strength))
  )
}

/**
 * Lead — discovers and scores companies/contacts to the monthly quota (50/mo
 * on Lead Generation Pro), enriches, and maintains the lead pool with contact
 * info and match rationale. Tools: lead source (mocked until the discovery
 * adapter lands); scoring via the internal_v1 model tuned by ICP. Boundary:
 * no auto-contact, no direct CRM updates.
 */
export function createLeadAgent(deps: LeadDeps): AgentInterface {
  return {
    id: 'lead',
    boundary: LEAD_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }

      const scoring = context.config.leadScoring
      if (!scoring) {
        return {
          status: 'error',
          error: 'lead agent requires the leadScoring config block (Lead Generation Pro)',
        }
      }

      const tuning: ScoringTuning = normalizeCriteriaWeights(context.config.icp.criteria)
      const source = await deps.leadSource.execute({}, toolContext(context))
      if (!source.ok) {
        return { status: 'error', error: source.error }
      }

      const candidates = (source.data as { candidates?: unknown }).candidates
      if (!Array.isArray(candidates) || !candidates.every(isCandidate)) {
        return { status: 'error', error: 'lead source returned malformed candidates' }
      }

      const scored: ScoredLead[] = candidates
        .map((candidate) => {
          const score = scoreLead(candidate.signals, tuning)
          return {
            workspaceId: context.workspaceId,
            company: candidate.company,
            contact: candidate.contact,
            country: candidate.country,
            score,
            tier: tierForScore(score, scoring.tiers),
            rationale: scoreRationale(candidate.signals, tuning),
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, scoring.monthlyQuota)

      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        quota: scoring.monthlyQuota,
        leads: scored,
      })
    },
  }
}
