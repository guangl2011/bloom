import { defineTool, type ScanEngineId, type ScanEngineInterface, type ScanQuery, type ScanSignal, type ToolInterface } from '@bloom/interfaces'

/**
 * In-memory mock externals for the six agents (spec D3: all externals mocked
 * until real adapters land). Each mock records its calls so tests can assert
 * on behavior; none reaches the network.
 */

export type MockScanEngine = ScanEngineInterface & { readonly queries: ScanQuery[] }

/** Mock scan engine — records every query for assertions. */
export function createMockScanEngine(
  id: ScanEngineId,
  signals: readonly ScanSignal[],
): MockScanEngine {
  const queries: ScanQuery[] = []
  return {
    id,
    queries,
    async scan(query: ScanQuery): Promise<ScanSignal[]> {
      queries.push(query)
      return [...signals]
    },
  }
}

/** Mock scan engine that always fails — exercises the fallback path. */
export function createFailingScanEngine(id: ScanEngineId, message = `${id} unavailable`): ScanEngineInterface {
  return {
    id,
    async scan(): Promise<ScanSignal[]> {
      throw new Error(message)
    },
  }
}

export interface MockCandidate {
  readonly company: string
  readonly contact: string
  readonly country: string
  /** Signal strength in [0, 1] per ICP criterion id. */
  readonly signals: Readonly<Record<string, number>>
}

/** Mock lead source — returns the fixture candidate pool. */
export function createMockLeadSourceTool(candidates: readonly MockCandidate[]): ToolInterface & { readonly callCount: number } {
  let calls = 0
  const tool = defineTool({
    name: 'lead-source',
    description: 'Mock lead discovery source (externals mocked in v1.0).',
    inputSchema: {},
    outputSchema: {
      candidates: { type: 'object[]', description: 'Candidate companies with per-criterion signal strengths', required: true },
    },
    async execute() {
      calls += 1
      return { ok: true as const, data: { candidates } }
    },
  })
  const counted = tool as ToolInterface & { readonly callCount: number }
  // Object.assign would snapshot the getter's value (always 0) — define a real
  // accessor so the counter stays live after executes.
  Object.defineProperty(counted, 'callCount', { get: () => calls, enumerable: true })
  return counted
}

export interface QueuedDraft {
  readonly draftId: string
  readonly to: string
  readonly subject: string
  readonly body: string
}

export interface SentEmail {
  readonly to: string
  readonly subject: string
  /** The queued draft the send executed — mirrors the real email adapter. */
  readonly draftId: string
  readonly approvalDecisionId: string
  readonly messageId: string
}

export interface MockEmailAdapter {
  /** Draft creation is not a gate action — drafts queue for review. */
  readonly draft: ToolInterface
  /** Structurally cannot send without an approval decision id in the input. */
  readonly send: ToolInterface
  readonly drafts: readonly QueuedDraft[]
  readonly sent: readonly SentEmail[]
}

/** Mock email adapter (draft + approved send). Real adapter lands with the outreach tasks. */
export function createMockEmailAdapter(): MockEmailAdapter {
  const drafts: QueuedDraft[] = []
  const sent: SentEmail[] = []
  const draft = defineTool({
    name: 'email.draft',
    description: 'Queue a personalized draft for human review.',
    inputSchema: {
      to: { type: 'string', description: 'Recipient contact email', required: true },
      subject: { type: 'string', description: 'Draft subject line', required: true },
      body: { type: 'string', description: 'Draft body', required: true },
    },
    outputSchema: {
      draftId: { type: 'string', description: 'Queued draft id', required: true },
    },
    async execute(input) {
      const record = input as { to: string; subject: string; body: string }
      const queued: QueuedDraft = { draftId: `draft-${drafts.length + 1}`, ...record }
      drafts.push(queued)
      return { ok: true as const, data: { draftId: queued.draftId } }
    },
  })
  const send = defineTool({
    name: 'email.send',
    description: 'Send an email — requires the queued draft id and the audit id of a recorded human approval decision.',
    inputSchema: {
      to: { type: 'string', description: 'Recipient contact email', required: true },
      subject: { type: 'string', description: 'Subject line', required: true },
      body: { type: 'string', description: 'Body', required: true },
      draftId: { type: 'string', description: 'Queued draft id the send executes', required: true },
      approvalDecisionId: {
        type: 'string',
        description: 'Audit id of the human approval decision — sends without one are structurally impossible',
        required: true,
      },
    },
    outputSchema: {
      messageId: { type: 'string', description: 'Sent message id', required: true },
    },
    async execute(input) {
      const record = input as {
        to: string
        subject: string
        draftId: string
        approvalDecisionId: string
      }
      const message: SentEmail = {
        to: record.to,
        subject: record.subject,
        draftId: record.draftId,
        approvalDecisionId: record.approvalDecisionId,
        messageId: `msg-${sent.length + 1}`,
      }
      sent.push(message)
      return { ok: true as const, data: { messageId: message.messageId } }
    },
  })
  return { draft, send, drafts, sent }
}

export interface CrmWrite {
  readonly opportunityId: string
  readonly nextStage: string
  readonly approvalDecisionId: string
  readonly crmRecordId: string
}

export interface MockCrmAdapter {
  /** Structurally cannot write without an approval decision id in the input. */
  readonly write: ToolInterface
  readonly writes: readonly CrmWrite[]
}

/** Mock CRM adapter — every write is approval-queued (spec locked decision 10). */
export function createMockCrmAdapter(): MockCrmAdapter {
  const writes: CrmWrite[] = []
  const write = defineTool({
    name: 'crm.write',
    description: 'Write a CRM record — requires the audit id of a recorded human approval decision.',
    inputSchema: {
      opportunityId: { type: 'string', description: 'CRM opportunity id', required: true },
      nextStage: { type: 'string', description: 'Stage to advance to (real adapter field name)', required: true },
      approvalDecisionId: { type: 'string', description: 'Audit id of the human approval decision', required: true },
    },
    outputSchema: {
      crmRecordId: { type: 'string', description: 'Written CRM record id', required: true },
    },
    async execute(input) {
      const record = input as {
        opportunityId: string
        nextStage: string
        approvalDecisionId: string
      }
      const written: CrmWrite = {
        ...record,
        crmRecordId: `crm-${writes.length + 1}`,
      }
      writes.push(written)
      return { ok: true as const, data: { crmRecordId: written.crmRecordId } }
    },
  })
  return { write, writes }
}

export interface MockCampaign {
  readonly platform: string
  readonly campaignId: string
  readonly name: string
  readonly status: string
  readonly budgetMonthly: number
  readonly spendMtd: number
}

export interface MockAdsAdapter {
  /** Read-only status query — no mutating tool exists on this adapter. */
  readonly status: ToolInterface
  readonly queriedPlatforms: readonly string[]
}

/** Mock ads adapter — read-only Google/LinkedIn status (spec locked decision 6). */
export function createMockAdsAdapter(campaigns: readonly MockCampaign[]): MockAdsAdapter {
  const queriedPlatforms: string[] = []
  const status = defineTool({
    name: 'ads.status',
    description: 'Read-only ad campaign status for one platform. Never spends, never modifies.',
    inputSchema: {
      platform: { type: 'string', description: "'google' or 'linkedin'", required: true },
    },
    outputSchema: {
      campaigns: { type: 'object[]', description: 'Campaign status rows', required: true },
    },
    async execute(input) {
      const record = input as { platform: string }
      queriedPlatforms.push(record.platform)
      const rows = campaigns.filter((campaign) => campaign.platform === record.platform)
      return { ok: true as const, data: { campaigns: rows } }
    },
  })
  return { status, queriedPlatforms }
}
