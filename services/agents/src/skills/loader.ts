import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAgentId, schemaSpecProblems, type AgentId, type SchemaSpec, type SkillDefinition } from '@bloom/interfaces'

interface RawSkillFile {
  name?: unknown
  agentId?: unknown
  version?: unknown
  description?: unknown
  promptFile?: unknown
  inputSchema?: unknown
  outputSchema?: unknown
}

function rawSkillProblems(raw: RawSkillFile): string[] {
  const problems: string[] = []
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    problems.push('name is required')
  }
  if (!isAgentId(raw.agentId)) {
    problems.push('agentId must be one of the six spec agents')
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    problems.push('version must be a positive integer')
  }
  if (typeof raw.description !== 'string' || raw.description.length === 0) {
    problems.push('description is required')
  }
  if (typeof raw.promptFile !== 'string' || raw.promptFile.length === 0) {
    problems.push('promptFile is required')
  }
  for (const key of ['inputSchema', 'outputSchema'] as const) {
    const specProblems = schemaSpecProblems(raw[key])
    problems.push(...specProblems.map((problem) => `${key}: ${problem}`))
  }
  return problems
}

/**
 * Loads one skill directory (skill.json + prompt file). Malformed assets
 * throw at load — versioned skill assets fail fast, never silently degrade.
 */
export function loadSkillFromDir(dir: string): SkillDefinition {
  const raw = JSON.parse(readFileSync(join(dir, 'skill.json'), 'utf8')) as RawSkillFile
  const problems = rawSkillProblems(raw)
  if (problems.length > 0) {
    throw new Error(`skill at ${dir} is malformed: ${problems.join('; ')}`)
  }
  const promptFile = raw.promptFile as string
  const prompt = readFileSync(join(dir, promptFile), 'utf8')
  if (prompt.trim().length === 0) {
    throw new Error(`skill at ${dir} has an empty prompt (${promptFile})`)
  }
  return {
    name: raw.name as string,
    agentId: raw.agentId as AgentId,
    version: raw.version as number,
    description: raw.description as string,
    prompt,
    inputSchema: raw.inputSchema as SchemaSpec,
    outputSchema: raw.outputSchema as SchemaSpec,
  }
}

/** Walks skills/<agent>/<skill>/ directories and loads every skill.json. */
export function loadAllSkills(skillsRoot: string): SkillDefinition[] {
  const skills: SkillDefinition[] = []
  for (const agentEntry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!isAgentId(agentEntry.name)) {
      continue
    }
    const agentDir = join(skillsRoot, agentEntry.name)
    for (const skillEntry of readdirSync(agentDir, { withFileTypes: true })) {
      if (skillEntry.isDirectory()) {
        skills.push(loadSkillFromDir(join(agentDir, skillEntry.name)))
      }
    }
  }
  return skills
}

/** Repo-root skills/, resolved from this module so callers don't depend on cwd. */
export function defaultSkillsRoot(): string {
  return fileURLToPath(new URL('../../../../skills', import.meta.url))
}
