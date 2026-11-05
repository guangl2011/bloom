import type {
  AgentId,
  AgentInterface,
  ScanEngineId,
  ScanEngineInterface,
  SkillDefinition,
  ToolInterface,
  WorkflowConfig,
} from '@bloom/interfaces'
import { workflowConfigProblems } from '@bloom/interfaces'
import { composeScanEngine } from './runtime/scan'
import type { CrmTools, EmailTools } from './tools/shapes'
import { createAdAgent } from './agents/ad'
import { createConversionAgent } from './agents/conversion'
import { createIcpAgent } from './agents/icp'
import { createLeadAgent } from './agents/lead'
import { createOutreachAgent } from './agents/outreach'
import { createRevenueIntelligenceAgent } from './agents/revenue-intelligence'

export interface AgentToolset {
  /** Engines by id — the registry the config selects from (Obvious primary, Deepline fallback). */
  readonly scanEngines: Readonly<Record<ScanEngineId, ScanEngineInterface>>
  readonly leadSource: ToolInterface
  readonly email: EmailTools
  readonly crm: CrmTools
  readonly ads: ToolInterface
}

/** Finds the skill an agent runs on; a missing skill is a wiring defect and throws. */
export function skillFor(skills: readonly SkillDefinition[], agentId: AgentId): SkillDefinition {
  const skill = skills.find((candidate) => candidate.agentId === agentId)
  if (!skill) {
    throw new Error(`no skill registered for agent ${agentId}`)
  }
  return skill
}

/**
 * Activates the roster a customer's package bought — config-driven, zero code
 * edits (spec: a package never runs an agent it didn't buy). Intelligence
 * Starter activates Revenue Intelligence + ICP; Lead Generation Pro adds
 * Lead, Outreach, and Conversion, with the read-only Ad agent optional per
 * intake (the ads config block's presence).
 */
export function activateAgents(
  tools: AgentToolset,
  skills: readonly SkillDefinition[],
  config: WorkflowConfig,
): readonly AgentInterface[] {
  const problems = workflowConfigProblems(config)
  if (problems.length > 0) {
    throw new Error(`invalid workflow config for ${config.customer}: ${problems.join('; ')}`)
  }

  const agents: AgentInterface[] = [
    createRevenueIntelligenceAgent({
      skill: skillFor(skills, 'revenue-intelligence'),
      scanEngine: composeScanEngine(config, tools.scanEngines),
    }),
    createIcpAgent({ skill: skillFor(skills, 'icp') }),
  ]

  if (config.package === 'lead_generation_pro') {
    agents.push(
      createLeadAgent({ skill: skillFor(skills, 'lead'), leadSource: tools.leadSource }),
      createOutreachAgent({ skill: skillFor(skills, 'outreach'), email: tools.email }),
      createConversionAgent({ skill: skillFor(skills, 'conversion'), crm: tools.crm }),
    )
    if (config.ads) {
      agents.push(createAdAgent({ skill: skillFor(skills, 'ad'), ads: tools.ads }))
    }
  }

  return agents
}
