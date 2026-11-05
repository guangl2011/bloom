import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Azure-port design test (spec D4): cloud SDK imports are confined to
 * adapters/adapter-deploy. If any other source file imports a GCP or Azure SDK,
 * the provider boundary has leaked and this fails — the fix is a new adapter
 * implementation, never an import elsewhere.
 */

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()

const ALLOWED_DIR = join(repoRoot, 'adapters/adapter-deploy')
const SDK_PATTERN =
  /(from\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])\s*(@google-cloud\/|googleapis|google-auth-library|@google-ai\/|firebase|@azure\/)/

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '.terraform'])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      out.push(...tsFiles(full))
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry) && !/\.(test)\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('cloud SDK import boundary', () => {
  it('finds no GCP/Azure SDK imports outside adapters/adapter-deploy', () => {
    const violations: string[] = []
    for (const file of tsFiles(repoRoot)) {
      if (file.startsWith(ALLOWED_DIR)) continue
      const text = readFileSync(file, 'utf8')
      if (SDK_PATTERN.test(text)) violations.push(file)
    }
    expect(violations, `cloud SDK imports leaked into: ${violations.join(', ')}`).toEqual([])
  })
})
