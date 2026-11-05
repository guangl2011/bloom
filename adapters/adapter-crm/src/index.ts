/**
 * @bloom/adapter-crm — approval-queued CRM writes (spec D3, locked decision
 * 10). The Conversion agent's write surface with the crm_write gate as
 * structure.
 */

export { createCrmAdapter, InMemoryCrmStore } from './adapter'
export type { CrmAdapter, CrmAdapterDeps, CrmStore } from './adapter'
export { applyTransition, computeTransition, CRM_STAGES, filterOpportunityRecord } from './record'
export type { CrmOpportunityRecord, CrmStage, TransitionPlan } from './record'
