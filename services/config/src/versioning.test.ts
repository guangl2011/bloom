import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileWorkflowConfig, persistCompiledConfig, parseWorkflowConfig } from './compiler.js'
import { ConfigVersionError, FileConfigVersionStore } from './versioning.js'
import { loadFieldMap, loadReferenceIntake } from './testutil.js'

const fieldMap = loadFieldMap()
const reference = loadReferenceIntake()

function newStore(): FileConfigVersionStore {
  return new FileConfigVersionStore(mkdtempSync(join(tmpdir(), 'bloom-config-')))
}

const tick = (() => {
  let n = 0
  return (): string => new Date(2026, 10, 5, 12, 0, n++).toISOString()
})()

describe('versioned workflow config (append-only)', () => {
  it('compiles v1, skips a no-op recompile, then appends v2 when the intake changes', () => {
    const store = newStore()
    const first = persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    expect(first).toMatchObject({ changed: true })
    expect(first.record.version).toBe(1)

    const again = persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    expect(again).toMatchObject({ changed: false, record: { version: 1 } })
    expect(store.history().length).toBe(1)

    const modified = structuredClone(reference)
    ;(modified['icp'] as Record<string, unknown>)['monthlyQuota'] = '75'
    const second = persistCompiledConfig(store, modified, fieldMap, { customer: 'reference-medspa', now: tick })
    expect(second).toMatchObject({ changed: true, record: { version: 2 } })
    expect(store.history().length).toBe(2)
  })

  it('writes workflow.yaml matching the newest record', () => {
    const store = newStore()
    persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    const current = readFileSync(join(store.dir, 'workflow.yaml'), 'utf8')
    expect(current).toBe(store.current()?.yaml)
  })

  it('restores an old version as a NEW version — history never rewrites', () => {
    const store = newStore()
    const v1 = persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    const modified = structuredClone(reference)
    ;(modified['markets'] as Record<string, unknown>)['regions'] = ['Spain']
    persistCompiledConfig(store, modified, fieldMap, { customer: 'reference-medspa', now: tick })

    const restored = store.restore(1, tick())
    expect(restored.version).toBe(3)
    expect(restored.intakeChecksum).toBe(v1.record.intakeChecksum)

    const expected = parseWorkflowConfig(v1.record.yaml) as Record<string, unknown>
    const actual = parseWorkflowConfig(restored.yaml) as Record<string, unknown>
    expect(actual).toEqual({ ...expected, version: 3 })
    expect(store.history().map((r) => r.version)).toEqual([1, 2, 3])
  })

  it('rejects a tampered audit log via checksum', () => {
    const store = newStore()
    const { record } = persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    const tampered = record.yaml.replace('Display Factory Wholesale', 'Mallory Industries')
    writeFileSync(join(store.dir, 'history.jsonl'), JSON.stringify({ ...record, yaml: tampered }) + '\n', 'utf8')
    expect(() => new FileConfigVersionStore(store.dir)).toThrow(ConfigVersionError)
  })

  it('rejects non-sequential versions in the audit log', () => {
    const store = newStore()
    const { record } = persistCompiledConfig(store, reference, fieldMap, { customer: 'reference-medspa', now: tick })
    const forged = { ...record, version: 7, yamlChecksum: record.yamlChecksum }
    writeFileSync(join(store.dir, 'history.jsonl'), JSON.stringify(record) + '\n' + JSON.stringify(forged) + '\n', 'utf8')
    expect(() => new FileConfigVersionStore(store.dir)).toThrow(/strictly increasing/)
  })

  it('checksums the same intake identically regardless of key order or nesting order', () => {
    const a = compileWorkflowConfig(reference, fieldMap, { customer: 'c', version: 1 })
    const reordered: Record<string, unknown> = {}
    for (const key of [...Object.keys(reference)].reverse()) reordered[key] = reference[key]
    const b = compileWorkflowConfig(reordered, fieldMap, { customer: 'c', version: 2 })
    expect(b.intakeChecksum).toBe(a.intakeChecksum)
  })
})
