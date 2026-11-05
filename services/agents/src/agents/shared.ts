import type { AgentContext, AgentResult, SkillDefinition, ToolContext } from '@bloom/interfaces'
import { formatViolations, validateAgainstSchema } from '@bloom/interfaces'

export type SkillInputCheck = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** Agents validate untrusted input against their skill's typed schema before doing work. */
export function validateSkillInput(skill: SkillDefinition, input: unknown): SkillInputCheck {
  const check = validateAgainstSchema(skill.inputSchema, input)
  return check.ok
    ? { ok: true }
    : { ok: false, error: `invalid input for skill ${skill.name}: ${formatViolations(check)}` }
}

/** Validates agent output against the skill's output schema — a mismatch is a defect, returned as an error result. */
export function validatedAgentResult(skill: SkillDefinition, data: unknown): AgentResult {
  const check = validateAgainstSchema(skill.outputSchema, data)
  return check.ok
    ? { status: 'ok', data }
    : { status: 'error', error: `skill ${skill.name} output violates its schema: ${formatViolations(check)}` }
}

/** Builds the ToolContext that links tool calls back to the agent run (traceability). */
export function toolContext(context: AgentContext): ToolContext {
  return { workspaceId: context.workspaceId, runId: context.runId }
}
