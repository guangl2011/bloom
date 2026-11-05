/**
 * Email adapter — the Outreach agent's real tool surface (spec D3, locked
 * decision 5/10). Drafts queue for review; every send crosses the email_send
 * gate.
 *
 * The gate is structural, not conventional: `provider.send` is reachable only
 * from inside the send tool's `execute`, whose first act is `gate.authorize`.
 * There is no exported path from a draft to a provider call that bypasses the
 * gate — an approval decision id is a required schema field, the draft must
 * exist and match the send, and the gate must hold a valid, unconsumed,
 * unexpired approval whose payload binds to the recipient and subject.
 *
 * Divergence from the agents' mock, deliberate: the real adapter never trusts
 * a caller-supplied `approver` string — the approver comes from the verified
 * gate decision, so a forged name cannot ride into the audit trail.
 */

import { defineTool } from '@bloom/interfaces'
import type { ToolContext, ToolInterface } from '@bloom/interfaces'
import type { GateAuthorizer } from '@bloom/svc-approval/gate'
import type { EmailProvider } from './provider'

/** Queued draft awaiting human review — the approval console reads these. */
export interface QueuedEmailDraft {
  readonly draftId: string
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly queuedAt: string
}

export interface DraftOutbox {
  queue(draft: Omit<QueuedEmailDraft, 'draftId' | 'queuedAt'>): Promise<QueuedEmailDraft>
  get(draftId: string): Promise<QueuedEmailDraft | undefined>
  all(): readonly QueuedEmailDraft[]
}

export class InMemoryDraftOutbox implements DraftOutbox {
  private readonly drafts = new Map<string, QueuedEmailDraft>()
  private seq = 0

  async queue(draft: Omit<QueuedEmailDraft, 'draftId' | 'queuedAt'>): Promise<QueuedEmailDraft> {
    this.seq += 1
    const queued: QueuedEmailDraft = {
      ...draft,
      draftId: `draft-${this.seq}`,
      queuedAt: new Date().toISOString(),
    }
    this.drafts.set(queued.draftId, queued)
    return queued
  }

  async get(draftId: string): Promise<QueuedEmailDraft | undefined> {
    return this.drafts.get(draftId)
  }

  all(): readonly QueuedEmailDraft[] {
    return [...this.drafts.values()]
  }
}

export interface EmailAdapterDeps {
  readonly provider: EmailProvider
  readonly gate: GateAuthorizer
  readonly outbox?: DraftOutbox
}

export interface EmailAdapter {
  /** Not a gate action — drafts are the review artifact humans approve. */
  readonly draft: ToolInterface
  /** The only send path; hard-gated on a verified human approval decision. */
  readonly send: ToolInterface
  readonly outbox: DraftOutbox
}

interface SendInput {
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly draftId: string
  readonly approvalDecisionId: string
}

export function createEmailAdapter(deps: EmailAdapterDeps): EmailAdapter {
  const outbox = deps.outbox ?? new InMemoryDraftOutbox()

  const draft = defineTool({
    name: 'email.draft',
    description: 'Queue a personalized email draft for human review. Not a gate action.',
    inputSchema: {
      to: { type: 'string', description: 'Recipient contact email', required: true },
      subject: { type: 'string', description: 'Draft subject line', required: true },
      body: { type: 'string', description: 'Draft body', required: true },
    },
    outputSchema: {
      draftId: { type: 'string', description: 'Queued draft id awaiting approval', required: true },
    },
    async execute(input: unknown) {
      const record = input as { to: string; subject: string; body: string }
      const queued = await outbox.queue(record)
      return { ok: true as const, data: { draftId: queued.draftId } }
    },
  })

  const send = defineTool({
    name: 'email.send',
    description:
      'Send a queued draft — requires the decision id of a recorded human approval whose payload binds to the recipient and subject.',
    inputSchema: {
      to: { type: 'string', description: 'Recipient contact email', required: true },
      subject: { type: 'string', description: 'Subject line', required: true },
      body: { type: 'string', description: 'Body — must match the approved draft', required: true },
      draftId: { type: 'string', description: 'Queued draft id to send', required: true },
      approvalDecisionId: {
        type: 'string',
        description: 'Audit id of the human approval decision — sends without one are structurally impossible',
        required: true,
      },
    },
    outputSchema: {
      messageId: { type: 'string', description: 'Sent message id from the provider', required: true },
      approvalDecisionId: { type: 'string', description: 'Approval decision the send consumed', required: true },
      approver: { type: 'string', description: 'Named approver from the verified gate record', required: true },
    },
    async execute(input: unknown, context: ToolContext) {
      const record = input as SendInput
      const approved = await outbox.get(record.draftId)
      if (!approved) {
        return { ok: false as const, error: `unknown draft ${record.draftId} — sends only execute queued drafts` }
      }
      if (approved.to !== record.to || approved.subject !== record.subject || approved.body !== record.body) {
        return {
          ok: false as const,
          error: `send input does not match queued draft ${record.draftId} — approve what you send, send what you approved`,
        }
      }

      // The gate is the only road to the provider: no valid, unconsumed,
      // unexpired approval bound to this recipient and subject → no send.
      const authorized = await deps.gate.authorize({
        workspaceId: context.workspaceId,
        decisionId: record.approvalDecisionId,
        action: 'email_send',
        ...(context.runId === undefined ? {} : { runId: context.runId }),
        binding: { to: record.to, subject: record.subject },
      })
      if (!authorized.ok) {
        return { ok: false as const, error: authorized.error }
      }

      const receipt = await deps.provider.send({
        to: record.to,
        subject: record.subject,
        body: record.body,
        draftId: record.draftId,
      })
      return {
        ok: true as const,
        data: {
          messageId: receipt.messageId,
          approvalDecisionId: record.approvalDecisionId,
          approver: authorized.approver,
        },
      }
    },
  })

  return { draft, send, outbox }
}
