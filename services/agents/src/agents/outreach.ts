import type { AgentContext, AgentInterface, AgentResult, SkillDefinition, WorkflowConfig } from '@bloom/interfaces'
import type { EmailTools } from '../tools/shapes'
import { toolContext, validateSkillInput, validatedAgentResult } from './shared'

export const OUTREACH_BOUNDARY = 'Nothing sends without a human approval decision'

export interface OutreachDeps {
  readonly skill: SkillDefinition
  readonly email: EmailTools
}

export interface OutreachLeadInput {
  readonly company: string
  readonly contact: string
  readonly score: number
  readonly tier: string
}

function isOutreachLead(value: unknown): value is OutreachLeadInput {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const lead = value as { company?: unknown; contact?: unknown; score?: unknown; tier?: unknown }
  return (
    typeof lead.company === 'string' &&
    typeof lead.contact === 'string' &&
    typeof lead.score === 'number' &&
    Number.isFinite(lead.score) &&
    typeof lead.tier === 'string'
  )
}

/** Deterministic draft generation — pure so tests and future LLM routing can wrap it. */
export function draftEmail(lead: OutreachLeadInput, config: WorkflowConfig): { subject: string; body: string } {
  const keyword = config.marketIntel.keywords[0] ?? 'your product line'
  const regions = config.marketIntel.regions.join(', ')
  return {
    subject: `${keyword} — partnership opportunity for ${lead.company}`,
    body: [
      `Hello ${lead.contact},`,
      '',
      `${config.customer} works with ${regions}-based partners looking for ${keyword}.`,
      `${lead.company} matched our ideal partner profile (score ${lead.score.toFixed(2)}, tier ${lead.tier}).`,
      'Would you be open to a short call next week?',
      '',
      '— Sent via Bloom (draft pending human approval)',
    ].join('\n'),
  }
}

/**
 * Outreach — email automation first: drafts personalized sequences, queues
 * them for approval, and executes approved sends up to the daily cap. Every
 * send crosses the email_send gate; the send tool structurally requires the
 * decision id. Boundary: nothing sends without a human approval decision.
 */
export function createOutreachAgent(deps: OutreachDeps): AgentInterface {
  return {
    id: 'outreach',
    boundary: OUTREACH_BOUNDARY,
    async run(context: AgentContext): Promise<AgentResult> {
      const inputCheck = validateSkillInput(deps.skill, context.input)
      if (!inputCheck.ok) {
        return { status: 'error', error: inputCheck.error }
      }

      const outreach = context.config.outreach
      if (!outreach) {
        return {
          status: 'error',
          error: 'outreach agent requires the outreach config block (Lead Generation Pro)',
        }
      }

      const input = context.input as { leads?: unknown }
      const leads = input.leads
      if (!Array.isArray(leads) || !leads.every(isOutreachLead)) {
        return {
          status: 'error',
          error: 'outreach input requires a leads array of { company, contact, score, tier }',
        }
      }

      let drafts = 0
      let sent = 0
      let queued = 0
      let rejected = 0

      for (const lead of leads) {
        const draft = draftEmail(lead, context.config)
        const draftResult = await deps.email.draft.execute(
          { to: lead.contact, subject: draft.subject, body: draft.body },
          toolContext(context),
        )
        if (!draftResult.ok) {
          return { status: 'error', error: draftResult.error }
        }
        drafts += 1
        const draftId = (draftResult.data as { draftId?: unknown }).draftId

        const decision = await context.approvals.request({
          action: 'email_send',
          requestedBy: 'outreach',
          reason: `send draft ${String(draftId)} to ${lead.contact}`,
          skill: { name: deps.skill.name, version: deps.skill.version },
          payload: { to: lead.contact, subject: draft.subject },
        })
        if (!decision.approved) {
          rejected += 1
          continue
        }
        if (sent >= outreach.dailySendCap) {
          queued += 1
          continue
        }
        const sendResult = await deps.email.send.execute(
          {
            to: lead.contact,
            subject: draft.subject,
            body: draft.body,
            // The queued draft this send executes — the adapter verifies the
            // send matches the draft (approve what you send).
            draftId: String(draftId),
            approvalDecisionId: decision.decisionId,
            // No caller `approver`: the real adapter takes the approver from
            // the verified gate decision, never from the caller's hands.
          },
          toolContext(context),
        )
        if (!sendResult.ok) {
          return { status: 'error', error: sendResult.error }
        }
        sent += 1
      }

      return validatedAgentResult(deps.skill, {
        workspaceId: context.workspaceId,
        drafts,
        sent,
        queued,
        rejected,
      })
    },
  }
}
