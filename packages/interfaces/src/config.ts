/**
 * WorkflowConfig — the compiled per-customer workflow vocabulary (spec D3).
 * The intake compiler (services/config) turns a customer's intake.json into
 * this shape; agents read behavior from it, never from code. The shape mirrors
 * the reference workflow config YAML in the spec, with one deliberate
 * deviation: gate actions are NOT config — they are hard invariants in code
 * (locked decision 10), so no `approval.gate_actions` field exists here.
 */

import type { ScanEngineId } from './scan-engine'

export const SERVICE_PACKAGES = ['intelligence_starter', 'lead_generation_pro'] as const
export type ServicePackage = (typeof SERVICE_PACKAGES)[number]

export interface IcpCriterion {
  readonly id: string
  readonly description: string
  /** Relative weight; the ICP agent normalizes weights to sum to 1. */
  readonly weight: number
}

export interface TierBound {
  readonly min?: number
  readonly max?: number
}

export interface MarketIntelConfig {
  /** Cron string for the monthly brief — executed on Obvious scheduled tasks. */
  readonly schedule?: string
  readonly keywords: readonly string[]
  readonly regions: readonly string[]
}

export interface PurchaseSignalConfig {
  readonly schedule?: string
  /** Engine selection is config — flipping it never touches agent code (spec locked decision 3). */
  readonly engine: {
    readonly primary: ScanEngineId
    readonly fallback: ScanEngineId
  }
  readonly maxSignalsPerPeriod: number
}

export interface LeadScoringConfig {
  readonly model: 'internal_v1'
  readonly monthlyQuota: number
  readonly tiers: {
    readonly A: TierBound
    readonly B: TierBound
    readonly C: TierBound
  }
}

export interface OutreachConfig {
  /** Email automation first (spec locked decision 5); v2.0 upgrades the automation layer. */
  readonly channels: readonly 'email'[]
  readonly mode: 'approval_gated_send'
  readonly dailySendCap: number
}

/** Ads cover Google and LinkedIn only, read-only recommendations in v1.0 (spec locked decision 6). */
export interface AdsConfig {
  readonly platforms: readonly ('google' | 'linkedin')[]
}

export interface WorkflowConfig {
  readonly workspaceId: string
  readonly customer: string
  readonly package: ServicePackage
  readonly marketIntel: MarketIntelConfig
  readonly purchaseSignals: PurchaseSignalConfig
  readonly icp: {
    readonly criteria: readonly IcpCriterion[]
  }
  /** Lead Generation Pro only — a package never runs an agent it didn't buy. */
  readonly leadScoring?: LeadScoringConfig
  readonly outreach?: OutreachConfig
  readonly ads?: AdsConfig
  /** Approval contacts from the intake contract; the approval service routes to them. */
  readonly approval?: {
    readonly approvers: readonly string[]
  }
}

/**
 * Config-level completeness problems; an empty list means the config can be
 * activated. Package/block consistency mirrors the intake compiler's
 * completeness checks at the config layer.
 */
export function workflowConfigProblems(config: WorkflowConfig): string[] {
  const problems: string[] = []
  if (config.workspaceId.length === 0) {
    problems.push('workspaceId is required')
  }
  if (config.customer.length === 0) {
    problems.push('customer is required')
  }
  if (config.marketIntel.keywords.length === 0) {
    problems.push('at least one monitoring keyword is required')
  }
  if (config.marketIntel.regions.length === 0) {
    problems.push('at least one region is required')
  }
  if (!(config.purchaseSignals.maxSignalsPerPeriod > 0)) {
    problems.push('maxSignalsPerPeriod must be positive')
  }
  if (config.icp.criteria.length === 0) {
    problems.push('at least one ICP criterion is required')
  }
  for (const criterion of config.icp.criteria) {
    if (!(criterion.weight > 0)) {
      problems.push(`ICP criterion ${criterion.id} must have a positive weight`)
    }
  }
  if (config.package === 'lead_generation_pro') {
    if (!config.leadScoring) {
      problems.push('lead_generation_pro requires the leadScoring block')
    }
    if (!config.outreach) {
      problems.push('lead_generation_pro requires the outreach block')
    }
  }
  if (config.leadScoring && !(config.leadScoring.monthlyQuota > 0)) {
    problems.push('monthlyQuota must be positive')
  }
  return problems
}
