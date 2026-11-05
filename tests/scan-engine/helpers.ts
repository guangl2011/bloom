/**
 * Integration-test support for the scan-engine layer: compiles the REAL
 * reference intake (the D2 fixture) into versioned workflow YAML and builds
 * tracked transport-seamed engines — the same factories production wiring
 * uses, with the network edge mocked. No live calls.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldMap, compileWorkflowConfig, type FieldMap as FieldMapType } from '@bloom/svc-config'
import {
  createDeeplineScanEngine,
  createObviousScanEngine,
  type RawSignalRecord,
  type ScanEngineWithDiagnostics,
  type ScanTransportRequest,
} from '@bloom/adapter-scan-engine'
import type { WorkflowConfig } from '@bloom/interfaces'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const NOW = Date.parse('2026-11-05T00:00:00Z')

export function loadFieldMap(): FieldMapType {
  const csv = readFileSync(join(REPO_ROOT, 'templates', 'customer-intake', '08-field-map-internal.csv'), 'utf8')
  return FieldMap.fromCsv(csv)
}

export function loadReferenceIntake(): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'intake', 'reference.intake.json'), 'utf8')) as unknown
}

/** Compiles the reference Lead Pro intake into the compiled workflow YAML text. */
export function compileReferenceWorkflowYaml(): string {
  return compileWorkflowConfig(loadReferenceIntake(), loadFieldMap(), { customer: 'reference-medspa', version: 1 }).yaml
}

/** Flips the engine selection in the compiled YAML TEXT — the config-not-code swap point. */
export function flipEngineSelection(yaml: string): string {
  const flipped = yaml.replace('primary: obvious', 'primary: deepline').replace('fallback: deepline', 'fallback: obvious')
  if (flipped === yaml) {
    throw new Error('flipEngineSelection found nothing to flip — compiled YAML shape drifted')
  }
  return flipped
}

export interface TrackedEngine {
  readonly engine: ScanEngineWithDiagnostics
  readonly transportCalls: () => number
  readonly lastRequest: () => ScanTransportRequest | undefined
}

export interface TrackedEngineOptions {
  /**
   * Persistent state's dedupe-key set, shared by reference across runs — the
   * engine reads it per scan, so test runs simulate state accumulating.
   */
  readonly knownKeys?: Set<string>
}

function trackedObvious(outcome: readonly RawSignalRecord[] | Error, options: TrackedEngineOptions = {}): TrackedEngine {
  let calls = 0
  let lastRequest: ScanTransportRequest | undefined
  const transport = async (request: ScanTransportRequest) => {
    calls += 1
    lastRequest = request
    if (outcome instanceof Error) {
      throw outcome
    }
    return { records: outcome }
  }
  return {
    engine: createObviousScanEngine({ transport, now: () => NOW, knownKeys: options.knownKeys }),
    transportCalls: () => calls,
    lastRequest: () => lastRequest,
  }
}

function trackedDeepline(outcome: readonly RawSignalRecord[] | Error, options: TrackedEngineOptions = {}): TrackedEngine {
  let calls = 0
  let lastRequest: ScanTransportRequest | undefined
  const transport = async (request: ScanTransportRequest) => {
    calls += 1
    lastRequest = request
    if (outcome instanceof Error) {
      throw outcome
    }
    return { results: outcome }
  }
  return {
    engine: createDeeplineScanEngine({ transport, now: () => NOW, knownKeys: options.knownKeys }),
    transportCalls: () => calls,
    lastRequest: () => lastRequest,
  }
}

/** Real engine factory + mocked transport edge, with call tracking. */
export function trackTransport(
  engineId: 'obvious' | 'deepline',
  outcome: readonly RawSignalRecord[] | Error,
  options?: TrackedEngineOptions,
): TrackedEngine {
  return engineId === 'obvious' ? trackedObvious(outcome, options) : trackedDeepline(outcome, options)
}

/** Minimal camelCase runtime config for the services/agents wiring seam. */
export function runtimeConfig(engine: { readonly primary: 'obvious' | 'deepline'; readonly fallback: 'obvious' | 'deepline' }): WorkflowConfig {
  return {
    workspaceId: 'ws_reference',
    customer: 'reference-medspa',
    package: 'lead_generation_pro',
    marketIntel: { keywords: ['display rack'], regions: ['EU'] },
    purchaseSignals: { engine, maxSignalsPerPeriod: 50 },
    icp: { criteria: [{ id: 'exporter', description: 'exports to target regions', weight: 1 }] },
    leadScoring: {
      model: 'internal_v1',
      monthlyQuota: 50,
      tiers: { A: { min: 0.8 }, B: { min: 0.5, max: 0.8 }, C: { min: 0.3, max: 0.5 } },
    },
  }
}
