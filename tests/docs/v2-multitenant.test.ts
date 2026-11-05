import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const DOC_PATH = 'docs/V2-MULTITENANT.md'

/** The six sections the D6 brief requires (deliverable D6, spec v3.1). */
const REQUIRED_SECTIONS = [
  'Migration steps',
  'workspace_id enforcement at the query layer',
  'Per-workspace RBAC activation',
  'Billing swap: Stripe/Paddle subscriptions',
  'Shared-deployment topology',
  'Mastra upgrade behind AgentInterface',
] as const

const doc = readFileSync(join(REPO_ROOT, DOC_PATH), 'utf8')

/** Backticked repo-relative paths cited in the doc (dirs like `services/credits` included). */
function citedRepoPaths(): string[] {
  const matches = doc.match(/`((?:packages|services|adapters|apps|infra|tests|docs|skills)\/[A-Za-z0-9_\-./]+?)`/g) ?? []
  return [...new Set(matches.map((m) => m.slice(1, -1).replace(/[.:,]$/, '')))]
}

/** Future v2.0 modules the doc cites as PLANNED — they must NOT exist at the v1.0 head. */
const PLANNED_V2_PATHS = [
  'services/billing',
  'services/agents/src/runtime/mastra.ts',
  'tests/db/cross-workspace.test.ts',
] as const

describe('docs/V2-MULTITENANT.md (D6 design note)', () => {
  it('exists and covers the six required sections', () => {
    for (const section of REQUIRED_SECTIONS) {
      expect(doc, `missing required section: ${section}`).toContain(section)
      const heading = doc.split('\n').find((line) => line.startsWith('##') && line.includes(section))
      expect(heading, `section "${section}" must be a heading, not a passing mention`).toBeDefined()
    }
  })

  it('has an explicit zero-change vs changes split', () => {
    expect(doc).toContain('Needs zero change')
    expect(doc).toContain('What changes')
  })

  it('cites only repo paths that exist at this head', () => {
    const cited = citedRepoPaths().filter((p) => !PLANNED_V2_PATHS.includes(p as never))
    const missing = cited.filter((p) => !existsSync(join(REPO_ROOT, p)))
    expect(missing, `cited paths that do not exist: ${missing.join(', ')}`).toEqual([])
  })

  it('planned v2.0 modules do not exist yet — designed, not built', () => {
    const built = PLANNED_V2_PATHS.filter((p) => existsSync(join(REPO_ROOT, p)))
    expect(built, `v2.0 modules that already exist: ${built.join(', ')}`).toEqual([])
  })

  it('grounds the Mastra swap and scan failover in the actual interface files', () => {
    for (const grounding of [
      'packages/interfaces/src/agent.ts',
      'packages/interfaces/src/workflow.ts',
      'packages/interfaces/src/scan-engine.ts',
      'services/agents/src/runtime/hermes.ts',
      'services/agents/src/runtime/scan.ts',
    ]) {
      expect(doc, `zero-change claims must cite ${grounding}`).toContain(grounding)
    }
  })
})
