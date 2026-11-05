/**
 * SkillDefinition — a versioned prompt with typed schemas (PRD §6: versioned
 * prompts/workflows/skills; spec D3: every skill has typed schemas).
 */

import type { AgentId } from './ids'
import type { SchemaSpec } from './schema'

export interface SkillDefinition {
  readonly name: string
  readonly agentId: AgentId
  /** Monotonic per-skill version — bumped on prompt/schema changes, never edited silently. */
  readonly version: number
  readonly description: string
  /** The prompt body, loaded from the skill's manifest-declared prompt file. */
  readonly prompt: string
  readonly inputSchema: SchemaSpec
  readonly outputSchema: SchemaSpec
}
