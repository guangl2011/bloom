/**
 * The projection table — the customization contract in code.
 *
 * Every row projects one intake answer into one emitted config path, and
 * declares the field-map config key (sheet 08 of the intake template) that
 * documents it. The traceability guard (compiler.ts) fails compilation when a
 * `tracesTo` key does not exist in the field map or when an emitted path has
 * no provenance — so an untraced ("orphan") config key cannot ship.
 */
import { AGENT_IDS } from '@bloom/interfaces'
import type { ServicePackage } from './types.js'
import type { IntakeValue, Json, NormalizedIntake, Projection, Provenance } from './types.js'
import { asPositiveInt, approvalGatedMode, cronFromCadence, extractEmails, parseLanguages } from './transforms.js'
import type { ReportLanguage } from './transforms.js'

/** Package-default schedules (spec: monthly brief by the 1st, weekly signal push, competitor report by the 5th). */
export const DEFAULT_SCHEDULES = {
  marketIntel: '0 6 1 * *',
  purchaseSignals: '0 6 * * 1',
  competitorTracking: '0 6 5 * *',
} as const

/** Package-default scoring tiers (spec reference config; the model itself is internal_v1). */
export const DEFAULT_TIERS = { A: '>=0.8', B: '0.5-0.8', C: '0.3-0.5' } as const

const LEAD_PRO: readonly ServicePackage[] = ['lead_generation_pro']

/** camelCase → snake_case for config keys (`queryTerms` → `query_terms`). */
function snake(segment: string): string {
  return segment.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/**
 * Field-map config key → emitted path prefix. Keys not listed here derive
 * `workflow.` + snake(key). Entries that must NOT be prefixed with `workflow.`
 * (knowledge base, CRM, delivery plumbing) or that merge into a parent
 * section are explicit.
 */
const SECTION: Readonly<Record<string, string>> = {
  knowledge_base: 'knowledge_base',
  market_map: 'workflow.market_map',
  'icp.scoringTuning': 'workflow.lead_scoring.tuning',
  'market_intel.schedule': 'workflow.market_intel',
  'purchase_signals.schedule': 'workflow.purchase_signals',
  'purchase_signals.channels': 'workflow.purchase_signals',
  'purchase_signals.maxSignalsPerPeriod': 'workflow.purchase_signals',
  'competitor_tracking.schedule': 'workflow.competitor_tracking',
  'regional_analysis': 'workflow.regional_analysis',
  'regional_analysis.dimensions': 'workflow.regional_analysis',
  'lead.contactRoles': 'workflow.lead',
  'lead.quota': 'workflow.lead_scoring', // spec shape: lead_scoring.monthly_quota
  'outreach.mode': 'workflow.outreach',
  'outreach.channelPlan': 'workflow.outreach.channel_plan',
  'outreach.emailAdapter': 'workflow.outreach.email_adapter',
  'outreach.talkingPoints': 'workflow.outreach.talking_points',
  'outreach.dailySendCap': 'workflow.outreach',
  'approval.approvers': 'approval.approvers',
  'approval.channels': 'approval',
  'approval.sla': 'approval',
  'delivery.contactRouting': 'delivery',
  'delivery.signalRouting': 'delivery',
  'delivery.recipientList': 'delivery.recipient_list',
  'delivery.acceptanceCriteria': 'delivery',
  'report.generation': 'report.generation',
  'crm.adapter': 'crm.adapter',
  'ads.adapters': 'ads.adapters',
  'compliance': 'compliance',
  'agent_roster': 'agent_roster',
  'workflow.freeformNotes': 'workflow.freeform_notes',
}

function sectionOf(tracesTo: string): string {
  const explicit = SECTION[tracesTo]
  if (explicit !== undefined) return explicit
  return 'workflow.' + tracesTo.split('.').map(snake).join('.')
}

function emittedPath(projection: Projection): string {
  if (projection.path !== undefined) return projection.path
  if (projection.leaf === undefined) {
    throw new Error(`projection for "${projection.intakeKey}" needs a leaf key or an explicit path`)
  }
  return `${sectionOf(projection.tracesTo)}.${projection.leaf}`
}

const packageRoster = (value: IntakeValue | undefined): Json | undefined => {
  const pkg = Array.isArray(value) ? value[0] : value
  if (pkg === 'intelligence_starter') {
    return AGENT_IDS.filter((id) => id === 'revenue-intelligence' || id === 'icp')
  }
  if (pkg === 'lead_generation_pro') return [...AGENT_IDS]
  return undefined
}

const packageScalar = (value: IntakeValue | undefined): Json | undefined => {
  const pkg = Array.isArray(value) ? value[0] : value
  return pkg === undefined ? undefined : (pkg as Json)
}

/** The full projection table: intake answer → traced config path. */
export const PROJECTIONS: readonly Projection[] = [
  // ---- Sheet 01 · Company Profile --------------------------------------
  { intakeKey: 'company.name', tracesTo: 'knowledge_base', leaf: 'name' },
  { intakeKey: 'company.name', tracesTo: 'market_intel.seed', leaf: 'name' },
  { intakeKey: 'company.brand', tracesTo: 'knowledge_base', leaf: 'brand' },
  { intakeKey: 'company.website', tracesTo: 'knowledge_base', leaf: 'website' },
  { intakeKey: 'company.website', tracesTo: 'market_intel.seed', leaf: 'website' },
  { intakeKey: 'company.businessType', tracesTo: 'icp.scoringTuning', leaf: 'business_type' },
  { intakeKey: 'company.hqAddress', tracesTo: 'knowledge_base', leaf: 'hq_address' },
  { intakeKey: 'company.branches', tracesTo: 'knowledge_base', leaf: 'branches' },
  { intakeKey: 'company.contacts', tracesTo: 'delivery.contactRouting', leaf: 'contact_routing' },
  { intakeKey: 'company.yearFounded', tracesTo: 'knowledge_base', leaf: 'year_founded' },
  { intakeKey: 'company.employeeCount', tracesTo: 'knowledge_base', leaf: 'employee_count' },
  { intakeKey: 'company.revenueBand', tracesTo: 'knowledge_base', leaf: 'revenue_band' },
  { intakeKey: 'company.exportHistory', tracesTo: 'market_intel.seed', leaf: 'export_history' },
  { intakeKey: 'company.exportHistory', tracesTo: 'regional_analysis', leaf: 'export_history' },
  { intakeKey: 'company.currentMarkets', tracesTo: 'market_intel.seed', leaf: 'current_markets' },
  { intakeKey: 'company.currentMarkets', tracesTo: 'market_map', leaf: 'current_markets' },
  { intakeKey: 'company.salesChannels', tracesTo: 'market_map', leaf: 'sales_channels' },
  { intakeKey: 'company.salesChannels', tracesTo: 'outreach.channelPlan', leaf: 'channels', packages: LEAD_PRO },
  { intakeKey: 'company.systems', tracesTo: 'crm.adapter', leaf: 'existing_systems' },
  { intakeKey: 'company.systems', tracesTo: 'outreach.emailAdapter', leaf: 'existing', packages: LEAD_PRO },
  { intakeKey: 'company.painPoints', tracesTo: 'market_intel.focus', leaf: 'pain_points' },
  { intakeKey: 'company.growthGoals', tracesTo: 'market_intel.focus', leaf: 'growth_goals' },

  // ---- Sheet 02 · Product Lines & Export -------------------------------
  { intakeKey: 'products.categories', tracesTo: 'icp.scoringTuning', leaf: 'product_categories' },
  { intakeKey: 'products.categories', tracesTo: 'market_map', leaf: 'product_categories' },
  { intakeKey: 'products.hsCodes', tracesTo: 'purchase_signals.queryTerms', leaf: 'hs_codes' },
  { intakeKey: 'products.certifications', tracesTo: 'icp.scoringTuning', leaf: 'certifications' },
  { intakeKey: 'products.certifications', tracesTo: 'lead.enrichment', leaf: 'certifications', packages: LEAD_PRO },
  { intakeKey: 'products.priceBand', tracesTo: 'icp.scoringTuning', leaf: 'price_band' },
  { intakeKey: 'products.moq', tracesTo: 'icp.scoringTuning', leaf: 'moq' },
  { intakeKey: 'products.moq', tracesTo: 'lead.enrichment', leaf: 'moq', packages: LEAD_PRO },
  { intakeKey: 'products.customization', tracesTo: 'icp.scoringTuning', leaf: 'customization' },
  { intakeKey: 'products.customization', tracesTo: 'outreach.talkingPoints', leaf: 'customization', packages: LEAD_PRO },
  { intakeKey: 'products.productionLocation', tracesTo: 'knowledge_base', leaf: 'production_location' },
  { intakeKey: 'products.logistics', tracesTo: 'knowledge_base', leaf: 'logistics' },
  { intakeKey: 'products.seasonality', tracesTo: 'purchase_signals.schedule', leaf: 'seasonality_note' },
  { intakeKey: 'products.heroProducts', tracesTo: 'outreach.talkingPoints', leaf: 'hero_products', packages: LEAD_PRO },
  { intakeKey: 'products.heroProducts', tracesTo: 'market_map', leaf: 'hero_products' },

  // ---- Sheet 03 · Target Industries & Regions --------------------------
  { intakeKey: 'markets.industries', tracesTo: 'market_map', leaf: 'industries' },
  { intakeKey: 'markets.industries', tracesTo: 'lead.discovery', leaf: 'industries', packages: LEAD_PRO },
  { intakeKey: 'markets.industries', tracesTo: 'regional_analysis', leaf: 'industries' },
  { intakeKey: 'markets.regions', tracesTo: 'market_map', leaf: 'regions' },
  { intakeKey: 'markets.regions', tracesTo: 'purchase_signals.scope', leaf: 'regions' },
  { intakeKey: 'markets.regions', tracesTo: 'regional_analysis', leaf: 'regions' },
  { intakeKey: 'markets.customerSize', tracesTo: 'icp.scoringTuning', leaf: 'customer_size' },
  { intakeKey: 'markets.expansionPlan', tracesTo: 'regional_analysis', leaf: 'expansion_plan' },
  { intakeKey: 'markets.expansionPlan', tracesTo: 'market_intel.focus', leaf: 'expansion_plan' },
  { intakeKey: 'markets.decisionRoles', tracesTo: 'icp.scoringTuning', leaf: 'decision_roles' },
  { intakeKey: 'markets.decisionRoles', tracesTo: 'lead.contactRoles', leaf: 'contact_roles', packages: LEAD_PRO },
  { intakeKey: 'markets.exclusions', tracesTo: 'lead.discovery.filters', leaf: 'exclusions', packages: LEAD_PRO },
  { intakeKey: 'markets.exclusions', tracesTo: 'purchase_signals.filters', leaf: 'industry_exclusions' },
  { intakeKey: 'markets.regionalAnalysisDimensions', tracesTo: 'regional_analysis.dimensions', leaf: 'dimensions', packages: LEAD_PRO },

  // ---- Sheet 04 · Competitor List --------------------------------------
  { intakeKey: 'competitors.list', tracesTo: 'competitor_tracking', leaf: 'competitors', packages: LEAD_PRO },
  { intakeKey: 'competitors.list', tracesTo: 'market_map', leaf: 'competitors' },
  { intakeKey: 'competitors.differentiators', tracesTo: 'market_intel.focus', leaf: 'competitor_differentiators' },
  { intakeKey: 'competitors.winLoss', tracesTo: 'market_intel.focus', leaf: 'win_loss' },
  { intakeKey: 'competitors.winLoss', tracesTo: 'outreach.talkingPoints', leaf: 'win_loss', packages: LEAD_PRO },
  { intakeKey: 'competitors.monitoringFocus', tracesTo: 'competitor_tracking.scope', leaf: 'focus', packages: LEAD_PRO },
  { intakeKey: 'competitors.substitutes', tracesTo: 'competitor_tracking', leaf: 'substitutes', packages: LEAD_PRO },
  { intakeKey: 'competitors.substitutes', tracesTo: 'market_map', leaf: 'substitutes' },

  // ---- Sheet 05 · Keywords & Intent Signals ----------------------------
  { intakeKey: 'keywords.monitor', tracesTo: 'purchase_signals.queryTerms', leaf: 'monitor' },
  { intakeKey: 'keywords.monitor', tracesTo: 'market_intel.keywords', leaf: 'monitor' },
  { intakeKey: 'keywords.brand', tracesTo: 'market_intel.keywords', leaf: 'brand' },
  { intakeKey: 'keywords.brand', tracesTo: 'competitor_tracking.keywords', leaf: 'brand', packages: LEAD_PRO },
  { intakeKey: 'keywords.competitor', tracesTo: 'competitor_tracking.keywords', leaf: 'competitor', packages: LEAD_PRO },
  { intakeKey: 'keywords.intent', tracesTo: 'purchase_signals.intentPhrases', leaf: 'phrases' },
  { intakeKey: 'keywords.exclusions', tracesTo: 'purchase_signals.filters', leaf: 'exclusions' },
  { intakeKey: 'signals.channels', tracesTo: 'purchase_signals.channels', leaf: 'channels' },
  { intakeKey: 'signals.scanCadence', tracesTo: 'purchase_signals.schedule', leaf: 'schedule', transform: cronFromCadence(DEFAULT_SCHEDULES.purchaseSignals) },
  { intakeKey: 'signals.scanCadence', tracesTo: 'purchase_signals.schedule', leaf: 'schedule_source' },
  { intakeKey: 'signals.maxPerPeriod', tracesTo: 'purchase_signals.maxSignalsPerPeriod', leaf: 'max_signals_per_period', transform: asPositiveInt(50) },
  { intakeKey: 'signals.noiseExamples', tracesTo: 'purchase_signals.filters', leaf: 'noise_examples' },
  { intakeKey: 'signals.pushTo', tracesTo: 'delivery.signalRouting', leaf: 'signal_routing' },

  // ---- Sheet 06 · ICP & Lead Criteria ----------------------------------
  { intakeKey: 'icp.description', tracesTo: 'icp.scoringTuning', leaf: 'icp_description' },
  { intakeKey: 'icp.criteriaA', tracesTo: 'icp.scoringTuning', leaf: 'criteria_a' },
  { intakeKey: 'icp.criteriaA', tracesTo: 'lead.tiering', leaf: 'criteria_a', packages: LEAD_PRO },
  { intakeKey: 'icp.criteriaB', tracesTo: 'icp.scoringTuning', leaf: 'criteria_b' },
  { intakeKey: 'icp.criteriaB', tracesTo: 'lead.tiering', leaf: 'criteria_b', packages: LEAD_PRO },
  { intakeKey: 'icp.criteriaC', tracesTo: 'icp.scoringTuning', leaf: 'criteria_c' },
  { intakeKey: 'icp.criteriaC', tracesTo: 'lead.tiering', leaf: 'criteria_c', packages: LEAD_PRO },
  { intakeKey: 'icp.weights', tracesTo: 'icp.scoringTuning', leaf: 'weights' },
  { intakeKey: 'icp.sizeThresholds', tracesTo: 'lead.discovery.filters', leaf: 'size_thresholds', packages: LEAD_PRO },
  { intakeKey: 'icp.geographicLimits', tracesTo: 'lead.discovery.filters', leaf: 'geographic_limits', packages: LEAD_PRO },
  { intakeKey: 'icp.monthlyQuota', tracesTo: 'lead.quota', leaf: 'monthly_quota', packages: LEAD_PRO, transform: asPositiveInt(50) },
  { intakeKey: 'icp.contactRoles', tracesTo: 'lead.enrichment', leaf: 'contact_roles', packages: LEAD_PRO },
  { intakeKey: 'icp.leadFields', tracesTo: 'lead.poolSchema', leaf: 'required_fields', packages: LEAD_PRO },
  { intakeKey: 'icp.disqualifiers', tracesTo: 'lead.discovery.filters', leaf: 'disqualifiers', packages: LEAD_PRO },
  { intakeKey: 'icp.complianceLimits', tracesTo: 'lead.discovery.filters', leaf: 'compliance_limits', packages: LEAD_PRO },
  { intakeKey: 'icp.complianceLimits', tracesTo: 'compliance', leaf: 'limits' },

  // ---- Sheet 07 · Delivery & Approvals ---------------------------------
  { intakeKey: 'package', tracesTo: 'agent_roster', path: 'package', transform: packageScalar },
  { intakeKey: 'package', tracesTo: 'agent_roster', path: 'agent_roster', transform: packageRoster },
  { intakeKey: 'delivery.reportCadence', tracesTo: 'market_intel.schedule', leaf: 'schedule', transform: cronFromCadence(DEFAULT_SCHEDULES.marketIntel) },
  { intakeKey: 'delivery.reportCadence', tracesTo: 'market_intel.schedule', leaf: 'schedule_source' },
  { intakeKey: 'delivery.reportCadence', tracesTo: 'competitor_tracking.schedule', leaf: 'schedule', packages: LEAD_PRO, transform: cronFromCadence(DEFAULT_SCHEDULES.competitorTracking) },
  { intakeKey: 'delivery.reportCadence', tracesTo: 'competitor_tracking.schedule', leaf: 'schedule_source', packages: LEAD_PRO },
  { intakeKey: 'delivery.languages', tracesTo: 'report.generation', leaf: 'languages', transform: parseLanguages() },
  { intakeKey: 'delivery.recipients', tracesTo: 'delivery.recipientList', leaf: 'raw' },
  { intakeKey: 'delivery.recipients', tracesTo: 'delivery.recipientList', leaf: 'emails', transform: extractEmails },
  { intakeKey: 'delivery.outreachMode', tracesTo: 'outreach.mode', leaf: 'mode', packages: LEAD_PRO, transform: approvalGatedMode },
  { intakeKey: 'delivery.outreachMode', tracesTo: 'outreach.mode', leaf: 'mode_source', packages: LEAD_PRO },
  { intakeKey: 'delivery.dailySendCap', tracesTo: 'outreach.dailySendCap', path: 'workflow.outreach.daily_send_cap', packages: LEAD_PRO, transform: asPositiveInt(100) },
  { intakeKey: 'crm.system', tracesTo: 'crm.adapter', leaf: 'system' },
  { intakeKey: 'approvals.contacts', tracesTo: 'approval.approvers', leaf: 'contacts' },
  { intakeKey: 'approvals.contacts', tracesTo: 'approval.approvers', leaf: 'emails', transform: extractEmails },
  { intakeKey: 'approvals.channels', tracesTo: 'approval.channels', leaf: 'channels' },
  { intakeKey: 'approvals.sla', tracesTo: 'approval.sla', leaf: 'sla' },
  { intakeKey: 'ads.accounts', tracesTo: 'ads.adapters', leaf: 'accounts', packages: LEAD_PRO },
  { intakeKey: 'delivery.acceptanceCriteria', tracesTo: 'delivery.acceptanceCriteria', path: 'delivery.acceptance_criteria' },
  { intakeKey: 'delivery.notes', tracesTo: 'workflow.freeformNotes', path: 'workflow.freeform_notes' },
]

export interface ProjectionResult {
  /** Top-level scalars set by explicit-path projections. */
  package?: Json
  agent_roster?: Json
  /** Mutable section containers; the compiler adds the reserved envelope. */
  config: {
    workflow: Record<string, Json>
    approval: Record<string, Json>
    knowledge_base?: Record<string, Json>
    crm?: Record<string, Json>
    compliance?: Record<string, Json>
    report?: Record<string, Json>
    delivery?: Record<string, Json>
    ads?: Record<string, Json>
    agent_roster?: Json
  }
  provenance: Provenance[]
}

function setValue(root: Record<string, Json>, path: string, value: Json, seen: Set<string>): void {
  if (seen.has(path)) {
    throw new Error(`projection collision: two projections emit "${path}"`)
  }
  seen.add(path)
  const segments = path.split('.')
  const lastSegment = segments[segments.length - 1]
  if (lastSegment === undefined) throw new Error(`projection path "${path}" is empty`)
  let current: Record<string, Json> = root
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      throw new Error(`projection collision: "${segment}" in "${path}" is not an object`)
    }
    if (existing === undefined) {
      const created: Record<string, Json> = {}
      current[segment] = created
      current = created
    } else {
      current = existing as Record<string, Json>
    }
  }
  current[lastSegment] = value
}

/**
 * Project a validated intake document into config sections, recording
 * provenance for every emitted path. Answers that are absent or empty are
 * skipped (config carries only what the customer provided plus explicit
 * defaults); Lead-Pro-only projections are gated by package.
 */
export function projectIntake(intake: NormalizedIntake, pkg: ServicePackage): ProjectionResult {
  const workflow: Record<string, Json> = {}
  const approval: Record<string, Json> = {}
  const config: ProjectionResult['config'] = { workflow, approval }
  const provenance: Provenance[] = []
  const result: ProjectionResult = { config, provenance }
  const seen = new Set<string>()

  for (const projection of PROJECTIONS) {
    if (projection.packages !== undefined && !projection.packages.includes(pkg)) continue
    const raw = intake[projection.intakeKey]
    const value: Json | undefined =
      projection.transform !== undefined
        ? projection.transform(raw)
        : raw === undefined
          ? undefined
          : typeof raw === 'string'
            ? raw
            : [...raw]
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && value.trim() === '') continue

    const path = emittedPath(projection)
    const segments = path.split('.')
    const first = segments[0]
    if (first === undefined || segments.length === 0) {
      throw new Error(`projection path "${path}" is empty`)
    }
    if (segments.length === 1) {
      // Top-level scalar projections (package, agent_roster).
      if (first === 'package') result.package = value
      else if (first === 'agent_roster') result.agent_roster = value
      else throw new Error(`projection path "${path}" must live under a top-level section`)
    } else {
      setValue(getSection(config, first), segments.slice(1).join('.'), value, seen)
    }
    provenance.push({ path, tracesTo: projection.tracesTo, intakeKey: projection.intakeKey })
  }

  return result
}

function getSection(config: ProjectionResult['config'], section: string): Record<string, Json> {
  switch (section) {
    case 'workflow':
      return config.workflow
    case 'approval':
      return config.approval
    case 'knowledge_base':
      config.knowledge_base = config.knowledge_base ?? {}
      return config.knowledge_base
    case 'crm':
      config.crm = config.crm ?? {}
      return config.crm
    case 'compliance':
      config.compliance = config.compliance ?? {}
      return config.compliance
    case 'report':
      config.report = config.report ?? {}
      return config.report
    case 'delivery':
      config.delivery = config.delivery ?? {}
      return config.delivery
    case 'ads':
      config.ads = config.ads ?? {}
      return config.ads
    default:
      throw new Error(`unknown top-level config section "${section}"`)
  }
}

export { emittedPath, sectionOf }
export type { ReportLanguage }
