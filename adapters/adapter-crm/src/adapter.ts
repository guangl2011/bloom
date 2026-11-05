/**
 * CRM-write adapter — the Conversion agent's real tool surface (spec D3,
 * locked decision 10). Every write is approval-queued: the crm_write gate
 * stands between the tool and the store, and the store has no other caller.
 *
 * The gate is structural: `store.apply` is reachable only from inside the
 * write tool's `execute`, whose first acts are the record-model validation
 * and `gate.authorize` bound to { opportunityId, nextStage }. No exported
 * path writes without a verified human approval decision.
 */

import { defineTool } from '@bloom/interfaces'
import type { ToolContext, ToolInterface } from '@bloom/interfaces'
import type { GateAuthorizer } from '@bloom/svc-approval/gate'
import { applyTransition, computeTransition, filterOpportunityRecord } from './record'
import type { CrmOpportunityRecord } from './record'

export interface CrmStore {
  /** Workspace-scoped lookup; a foreign-workspace id is not found here. */
  get(workspaceId: string, opportunityId: string): Promise<CrmOpportunityRecord | undefined>
  /** The only write path — called only after the gate authorizes. */
  apply(record: CrmOpportunityRecord): Promise<void>
  /** Setup seam for seeding (imports, other agents' delivery flows). */
  insert(record: CrmOpportunityRecord): Promise<void>
}

export class InMemoryCrmStore implements CrmStore {
  private readonly records = new Map<string, CrmOpportunityRecord>()

  async get(workspaceId: string, opportunityId: string): Promise<CrmOpportunityRecord | undefined> {
    const record = this.records.get(opportunityId)
    return record && record.workspaceId === workspaceId ? record : undefined
  }

  async apply(record: CrmOpportunityRecord): Promise<void> {
    this.records.set(record.opportunityId, record)
  }

  async insert(record: CrmOpportunityRecord): Promise<void> {
    this.records.set(record.opportunityId, record)
  }
}

export interface CrmAdapterDeps {
  readonly store: CrmStore
  readonly gate: GateAuthorizer
  readonly now?: () => Date
}

export interface CrmAdapter {
  /** The only write path; hard-gated on a verified human approval decision. */
  readonly writeOpportunity: ToolInterface
  readonly store: CrmStore
}

interface WriteInput {
  readonly opportunityId: string
  readonly nextStage: string
  readonly approvalDecisionId: string
}

export function createCrmAdapter(deps: CrmAdapterDeps): CrmAdapter {
  const now = deps.now ?? (() => new Date())

  const writeOpportunity = defineTool({
    name: 'crm.writeOpportunity',
    description:
      'Advance an opportunity to a new stage — requires the decision id of a recorded human approval bound to the opportunity and stage.',
    inputSchema: {
      opportunityId: { type: 'string', description: 'Opportunity to write', required: true },
      nextStage: { type: 'string', description: 'Target stage after the write', required: true },
      approvalDecisionId: {
        type: 'string',
        description: 'Audit id of the human approval decision — writes without one are structurally impossible',
        required: true,
      },
    },
    outputSchema: {
      opportunityId: { type: 'string', description: 'Written opportunity id', required: true },
      previousStage: { type: 'string', description: 'Stage before the write', required: true },
      stage: { type: 'string', description: 'Stage after the write', required: true },
      version: { type: 'number', description: 'Record version after the write', required: true },
      approvalDecisionId: { type: 'string', description: 'Approval decision the write consumed', required: true },
      approver: { type: 'string', description: 'Named approver from the verified gate record', required: true },
    },
    async execute(input: unknown, context: ToolContext) {
      const record = input as WriteInput

      const existing = await deps.store.get(context.workspaceId, record.opportunityId)
      if (!existing) {
        return {
          ok: false as const,
          error: `unknown opportunity ${record.opportunityId} in this workspace — nothing to write`,
        }
      }

      const plan = computeTransition(existing, record.nextStage)
      if (!plan.ok) {
        return { ok: false as const, error: plan.error }
      }

      // The gate is the only road to the store: no valid, unconsumed,
      // unexpired approval bound to this opportunity and stage → no write.
      const authorized = await deps.gate.authorize({
        workspaceId: context.workspaceId,
        decisionId: record.approvalDecisionId,
        action: 'crm_write',
        ...(context.runId === undefined ? {} : { runId: context.runId }),
        binding: { opportunityId: record.opportunityId, nextStage: record.nextStage },
      })
      if (!authorized.ok) {
        return { ok: false as const, error: authorized.error }
      }

      await deps.store.apply(applyTransition(existing, plan, now()))
      return {
        ok: true as const,
        data: {
          opportunityId: record.opportunityId,
          previousStage: plan.from,
          stage: plan.to,
          version: existing.version + 1,
          approvalDecisionId: record.approvalDecisionId,
          approver: authorized.approver,
        },
      }
    },
  })

  return { writeOpportunity, store: deps.store }
}

export { filterOpportunityRecord }
