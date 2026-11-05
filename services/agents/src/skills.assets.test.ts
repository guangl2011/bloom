import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { schemaSpecProblems, AGENT_IDS } from '@bloom/interfaces'
import { defaultSkillsRoot, loadAllSkills, loadSkillFromDir } from './skills/loader'
import { ICP_BOUNDARY } from './agents/icp'
import { LEAD_BOUNDARY } from './agents/lead'
import { OUTREACH_BOUNDARY } from './agents/outreach'
import { AD_BOUNDARY } from './agents/ad'
import { CONVERSION_BOUNDARY } from './agents/conversion'
import { REVENUE_INTELLIGENCE_BOUNDARY } from './agents/revenue-intelligence'

/**
 * Skill-asset discipline (spec D3): every agent has a versioned skill with
 * typed schemas and a non-empty prompt that restates its hard boundary.
 * Malformed assets fail loudly at load — never silently degrade.
 */

describe('versioned skill assets', () => {
  const skills = loadAllSkills(defaultSkillsRoot())

  it('ships exactly one skill per spec agent', () => {
    expect(skills.length).toBe(AGENT_IDS.length)
    expect(new Set(skills.map((skill) => skill.agentId)).size).toBe(AGENT_IDS.length)
    for (const agentId of AGENT_IDS) {
      const skill = skills.find((candidate) => candidate.agentId === agentId)
      expect(skill, `missing skill for ${agentId}`).toBeTruthy()
    }
  })

  it('declares valid typed schemas on every skill', () => {
    for (const skill of skills) {
      expect(schemaSpecProblems(skill.inputSchema), skill.name).toEqual([])
      expect(schemaSpecProblems(skill.outputSchema), skill.name).toEqual([])
      expect(skill.version).toBeGreaterThanOrEqual(1)
    }
  })

  it('restates each agent’s hard boundary in the prompt', () => {
    const boundaries = new Map([
      ['revenue-intelligence', REVENUE_INTELLIGENCE_BOUNDARY],
      ['icp', ICP_BOUNDARY],
      ['lead', LEAD_BOUNDARY],
      ['outreach', OUTREACH_BOUNDARY],
      ['ad', AD_BOUNDARY],
      ['conversion', CONVERSION_BOUNDARY],
    ])
    for (const skill of skills) {
      const boundary = boundaries.get(skill.agentId)
      expect(boundary, `no boundary known for ${skill.agentId}`).toBeTruthy()
      expect(skill.prompt).toContain(boundary)
    }
  })
})

describe('skill loader failure modes', () => {
  it('throws a readable error on a malformed skill manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bloom-skill-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'skill.json'),
        JSON.stringify({ name: 'broken', agentId: 'not-an-agent', version: 0, description: '' }),
      )
      expect(() => loadSkillFromDir(dir)).toThrow(/agentId must be one of the six spec agents/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws when the declared prompt file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bloom-skill-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'skill.json'),
        JSON.stringify({
          name: 'no-prompt',
          agentId: 'icp',
          version: 1,
          description: 'd',
          promptFile: 'missing.md',
          inputSchema: {},
          outputSchema: {},
        }),
      )
      expect(() => loadSkillFromDir(dir)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
