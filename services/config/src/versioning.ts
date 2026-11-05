/**
 * Append-only workflow-config versioning.
 *
 * Every compile of a customer's intake produces a new config version with
 * full history (spec locked decision 12: workflow configs compile from the
 * intake workbook and are versioned; "每次配置变更均有版本记录").
 *
 * Layout under one config directory:
 *   workflow.yaml    — current config, human-reviewable
 *   history.jsonl    — append-only audit log, one JSON record per version
 *
 * History is immutable: restoring an old version appends a NEW version with
 * that content (never rewrites), so the audit trail stays monotonic.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Json } from './types.js'

export class ConfigVersionError extends Error {}

export interface ConfigVersionRecord {
  readonly version: number
  readonly compiledAt: string
  /** sha256 of the canonical intake the version was compiled from. */
  readonly intakeChecksum: string
  /** sha256 of the stored YAML. */
  readonly yamlChecksum: string
  readonly yaml: string
}

export interface ConfigVersionStore {
  append(yaml: string, intakeChecksum: string, compiledAt: string): ConfigVersionRecord
  current(): ConfigVersionRecord | undefined
  history(): readonly ConfigVersionRecord[]
  /** Re-activate an old version's content as a new version (history never rewrites). */
  restore(version: number, compiledAt: string): ConfigVersionRecord
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function asObject(yamlText: string): Record<string, Json> {
  const parsed: unknown = parseYaml(yamlText)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigVersionError('workflow config YAML must be a mapping at the top level')
  }
  return parsed as Record<string, Json>
}

interface StoredRecord extends ConfigVersionRecord {
  /** Restores re-stamp the version inside the YAML; records remember the original. */
  readonly restoredFrom?: number
}

function checksumOk(record: StoredRecord): boolean {
  return sha256(record.yaml) === record.yamlChecksum
}

/** File-backed store: workflow.yaml (current) + history.jsonl (append-only audit log). */
export class FileConfigVersionStore implements ConfigVersionStore {
  private readonly historyPath: string
  private readonly currentPath: string
  private records: StoredRecord[]

  constructor(readonly dir: string) {
    this.historyPath = join(dir, 'history.jsonl')
    this.currentPath = join(dir, 'workflow.yaml')
    this.records = this.load()
  }

  private load(): StoredRecord[] {
    let rawHistory: string | undefined
    try {
      rawHistory = readFileSync(this.historyPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records: StoredRecord[] = []
    for (const line of rawHistory.split('\n')) {
      if (line.trim() === '') continue
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new ConfigVersionError('history.jsonl contains a corrupt record')
      }
      const record = parsed as StoredRecord
      if (typeof record.version !== 'number' || typeof record.yaml !== 'string' || !checksumOk(record)) {
        throw new ConfigVersionError(`history record v${String(record.version)} failed its checksum — the audit log may be corrupted`)
      }
      asObject(record.yaml)
      records.push(record)
    }
    if (this.sequential(records) === false) {
      throw new ConfigVersionError('history.jsonl versions are not strictly increasing')
    }
    return records
  }

  private sequential(records: readonly StoredRecord[]): boolean {
    return records.every((record, index) => index === 0 || record.version === (records[index - 1]?.version ?? 0) + 1)
  }

  private persist(): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.historyPath, this.records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8')
    const current = this.records[this.records.length - 1]
    if (current !== undefined) writeFileSync(this.currentPath, current.yaml, 'utf8')
  }

  append(yaml: string, intakeChecksum: string, compiledAt: string): ConfigVersionRecord {
    asObject(yaml) // reject unparseable YAML before it enters the audit log
    const previous = this.records[this.records.length - 1]
    const record: StoredRecord = {
      version: (previous?.version ?? 0) + 1,
      compiledAt,
      intakeChecksum,
      yamlChecksum: sha256(yaml),
      yaml,
    }
    this.records.push(record)
    this.persist()
    return record
  }

  current(): ConfigVersionRecord | undefined {
    return this.records[this.records.length - 1]
  }

  history(): readonly ConfigVersionRecord[] {
    return this.records
  }

  restore(version: number, compiledAt: string): ConfigVersionRecord {
    const target = this.records.find((record) => record.version === version)
    if (target === undefined) {
      const known = this.records.map((record) => record.version).join(', ')
      throw new ConfigVersionError(`cannot restore unknown version ${version} (history: ${known || 'empty'})`)
    }
    // Re-stamp the version inside the YAML so the restored document is valid
    // as a new version; content otherwise identical to the target.
    const previous = this.records[this.records.length - 1]
    const nextVersion = (previous?.version ?? 0) + 1
    const parsed = asObject(target.yaml)
    parsed['version'] = nextVersion
    const yaml = stringifyYaml(parsed, { lineWidth: 0 }).trimEnd() + '\n'
    const record: StoredRecord = {
      version: nextVersion,
      compiledAt,
      intakeChecksum: target.intakeChecksum,
      yamlChecksum: sha256(yaml),
      yaml,
      restoredFrom: version,
    }
    this.records.push(record)
    this.persist()
    return record
  }

  /** Unexpected files in the config dir (workflow.yaml + history.jsonl are the only sanctioned ones). */
  listStrayFiles(): string[] {
    try {
      return readdirSync(this.dir).filter((name) => name !== 'workflow.yaml' && name !== 'history.jsonl')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}
