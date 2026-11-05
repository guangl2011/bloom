/**
 * Shared engine assembly. Both scan engines are the same machine around a
 * different transport: the transport is the engine's network seam — injected,
 * so tests never touch a live platform and the composition runtime owns
 * failover. Business logic lives here and in methodology.ts, never in a
 * runtime framework.
 */

import {
  DEFAULT_WINDOW_DAYS,
  MS_PER_DAY,
  SCAN_CHANNELS,
  finalizeScanRun,
  normalizeSignalRecord,
  type RawSignalRecord,
  type ScanChannel,
  type ScanDiagnostics,
  type ScanEngineId,
  type ScanEngineWithDiagnostics,
  type ScanQuery,
  type ScanRunResult,
  type ScanSignal,
  type SegmentRule,
} from './methodology.js'

/** What an engine transport hands the methodology: the query plus resolved channels. */
export interface ScanTransportRequest {
  readonly query: ScanQuery
  readonly channels: readonly ScanChannel[]
}

/** What a transport hands back: raw records already mapped to the core capture schema. */
export interface ResearchRunResult {
  readonly records: readonly RawSignalRecord[]
}

export interface EngineOptions {
  /** Source families to activate — from the compiled workflow YAML. Default: all channels. */
  readonly channels?: readonly ScanChannel[]
  readonly segments?: readonly SegmentRule[]
  /** Injected clock for deterministic tests; defaults to the system clock. */
  readonly now?: () => number
  readonly windowDays?: number
  /** Persistent state's dedupe keys — re-encounters are dropped from the run. */
  readonly knownKeys?: ReadonlySet<string>
}

/** Thrown when engine configuration names a channel the platform does not have. */
export class ScanEngineConfigError extends Error {}

/** Normalizes and validates a channel list; unknown values fail loudly naming the valid set. */
export function resolveChannels(input?: readonly ScanChannel[]): readonly ScanChannel[] {
  if (input === undefined) {
    return SCAN_CHANNELS
  }
  const resolved: ScanChannel[] = []
  for (const raw of input) {
    const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
    const channel = SCAN_CHANNELS.find((candidate) => candidate === normalized)
    if (channel === undefined) {
      throw new ScanEngineConfigError(`unknown scan channel '${raw}' — valid channels: ${SCAN_CHANNELS.join(', ')}`)
    }
    if (!resolved.includes(channel)) {
      resolved.push(channel)
    }
  }
  if (resolved.length === 0) {
    throw new ScanEngineConfigError(`scan channels are empty — valid channels: ${SCAN_CHANNELS.join(', ')}`)
  }
  return resolved
}

/**
 * The one engine factory. `runResearch` is the engine-specific transport edge;
 * everything downstream — normalization, dedupe, segments, windows,
 * diagnostics — is shared methodology, identical for every engine.
 */
export function createScanEngineFromTransport(
  options: EngineOptions & { readonly engineId: ScanEngineId },
  runResearch: (request: ScanTransportRequest) => Promise<ResearchRunResult>,
): ScanEngineWithDiagnostics {
  const channels = resolveChannels(options.channels)
  const now = options.now ?? Date.now
  const run = async (query: ScanQuery): Promise<ScanRunResult> => {
    const nowMs = now()
    const { records } = await runResearch({ query, channels })
    const normalized = records.map((record) =>
      normalizeSignalRecord(record, { engineId: options.engineId, nowMs, segments: options.segments }),
    )
    return finalizeScanRun(normalized, {
      engineId: options.engineId,
      channels,
      query,
      nowMs,
      windowDays: options.windowDays,
      knownKeys: options.knownKeys,
    })
  }
  return {
    id: options.engineId,
    // Copy out of the readonly run result — the plain engine contract returns a mutable array.
    scan: async (query) => [...(await run(query)).signals],
    scanWithDiagnostics: run,
  }
}

/**
 * Diagnostics for engines that only implement the plain ScanEngine contract —
 * synthesized from their signal list so failover composition never loses the
 * run-level view. Plain engines carry no timestamps or segments, so the
 * windowed aggregates are honestly zero and the finding says so.
 */
export function synthesizeDiagnostics(engineId: ScanEngineId, signals: readonly ScanSignal[]): ScanDiagnostics {
  const nowMs = Date.now()
  return {
    engineId,
    channels: [],
    recordsIn: signals.length,
    signalsOut: signals.length,
    duplicatesSuppressed: 0,
    knownSkipped: 0,
    perSource: {},
    rollingWindow: {
      windowDays: DEFAULT_WINDOW_DAYS,
      windowStart: new Date(nowMs - DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString(),
      withinWindow: 0,
      outsideWindow: 0,
      bySegment: {},
      bySignalType: {},
    },
    findings: [
      `diagnostics synthesized from a plain ScanEngine (${signals.length} signals, no native scanWithDiagnostics) — windowed aggregates unavailable`,
    ],
  }
}
