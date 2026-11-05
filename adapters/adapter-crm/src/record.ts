/**
 * CRM record model and transition logic (spec D3 — Conversion agent).
 *
 * Pure, side-effect-free: the transition table and record shaping live here
 * so the adapter's gate logic stays a thin dispatch and the rules are unit-
 * testable without any store.
 *
 * v1.0 scope: the CRM is the platform's own opportunity mirror — customers
 * connect their CRM later; there are no external CRM credentials in v1.0, so
 * no provider port exists yet. When a customer-CRM sync provider is
 * introduced it must carry the same zero-send guard posture as the email
 * relay provider (operational mode + explicit flag + credentials).
 */

export const CRM_STAGES = [
  'new',
  'qualified',
  'opportunity',
  'negotiation',
  'won',
  'lost',
] as const

export type CrmStage = (typeof CRM_STAGES)[number]

/** One tracked opportunity — workspace-scoped like every Bloom record. */
export interface CrmOpportunityRecord {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly company: string
  readonly contactName?: string
  readonly stage: CrmStage
  readonly updatedAt: string
  readonly version: number
}

export type TransitionPlan =
  | { readonly ok: true; readonly from: CrmStage; readonly to: CrmStage }
  | { readonly ok: false; readonly error: string }

/**
 * Validates a stage transition before anything is written: unknown stages
 * and no-op transitions are refused — the gate should never be asked to
 * approve a write the record model would reject.
 */
export function computeTransition(
  record: CrmOpportunityRecord,
  nextStage: string,
): TransitionPlan {
  if (!(CRM_STAGES as readonly string[]).includes(nextStage)) {
    return {
      ok: false,
      error: `unknown stage "${nextStage}" — valid stages: ${CRM_STAGES.join(', ')}`,
    }
  }
  if (record.stage === nextStage) {
    return { ok: false, error: `opportunity ${record.opportunityId} is already in stage "${nextStage}"` }
  }
  return { ok: true, from: record.stage, to: nextStage as CrmStage }
}

/** Applies a validated transition — returns a new record, never mutates. */
export function applyTransition(
  record: CrmOpportunityRecord,
  plan: Extract<TransitionPlan, { ok: true }>,
  at: Date,
): CrmOpportunityRecord {
  return {
    ...record,
    stage: plan.to,
    updatedAt: at.toISOString(),
    version: record.version + 1,
  }
}

/**
 * The write view of a record — what tools and the dashboard may see.
 * Internal fields (workspace id is context, not content) stay out.
 */
export function filterOpportunityRecord(
  record: CrmOpportunityRecord,
): Omit<CrmOpportunityRecord, 'workspaceId'> {
  const { workspaceId: _workspaceId, ...view } = record
  return view
}
