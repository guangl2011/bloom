/**
 * Deepline research-agent engine — the configured FALLBACK behind the same
 * interface (spec locked decision 3; deepline.com/docs). The transport seam is
 * the documented API edge; tests inject mocks and the production wiring uses
 * createDeeplineHttpTransport with DEEPLINE_API_KEY (via the secrets flow).
 *
 * The exact response mapping lives HERE so documented-API drift is an adapter
 * fix, never an agent fix. The core schema is identical to the Obvious
 * engine's — every source normalizes to the core capture schema.
 */

import { SIGNAL_TYPES, MalformedSignalRecordError, type RawSignalRecord, type ScanEngineWithDiagnostics, type SignalType } from './methodology.js'
import { createScanEngineFromTransport, type EngineOptions, type ResearchRunResult, type ScanTransportRequest } from './engine-core.js'

/** The research-run request — the engine's transport shape, named for this edge. */
export type DeeplineResearchRequest = ScanTransportRequest

function isSignalType(value: string): value is SignalType {
  return (SIGNAL_TYPES as readonly string[]).includes(value)
}

/** The Deepline API seam — injected; tests pass mocks, production passes createDeeplineHttpTransport. */
export type DeeplineTransport = (request: DeeplineResearchRequest) => Promise<unknown>

/** Thrown when a Deepline response does not match the documented shape — loud, never silently reshaped. */
export class DeeplineResponseError extends Error {}

/** One finding in the documented Deepline research-run response. */
export interface DeeplineFinding {
  readonly title?: unknown
  readonly url?: unknown
  readonly summary?: unknown
  readonly organization?: unknown
  readonly signalType?: unknown
  readonly publishedAt?: unknown
  readonly sourcePlatform?: unknown
}

function stringField(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DeeplineResponseError(`results[${index}].${field} must be a non-empty string — Deepline API drift is an adapter fix; fix mapDeeplineResponse`)
  }
  return value
}

/** Maps one documented finding to the core capture schema. Unknown fields never become data. */
export function mapDeeplineFinding(item: unknown, index: number, nowMs: number): RawSignalRecord {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new DeeplineResponseError(`results[${index}] must be an object — Deepline API drift is an adapter fix; fix mapDeeplineResponse`)
  }
  const finding = item as DeeplineFinding
  const title = stringField(finding.title, 'title', index)
  const url = stringField(finding.url, 'url', index)

  let signalType: SignalType = 'research_finding'
  if (finding.signalType !== undefined && finding.signalType !== null) {
    if (typeof finding.signalType !== 'string' || !isSignalType(finding.signalType)) {
      throw new DeeplineResponseError(
        `results[${index}].signalType '${String(finding.signalType)}' is not one of: ${SIGNAL_TYPES.join(', ')}`,
      )
    }
    signalType = finding.signalType
  }

  let observedAt = new Date(nowMs).toISOString()
  if (finding.publishedAt !== undefined && finding.publishedAt !== null) {
    if (typeof finding.publishedAt !== 'string' || Number.isNaN(Date.parse(finding.publishedAt))) {
      throw new DeeplineResponseError(`results[${index}].publishedAt must be an ISO 8601 timestamp`)
    }
    observedAt = finding.publishedAt
  }

  return {
    // Deepline is itself the aggregation platform; a per-result source name overrides.
    sourcePlatform: typeof finding.sourcePlatform === 'string' && finding.sourcePlatform.trim().length > 0
      ? finding.sourcePlatform.trim()
      : 'deepline',
    signalType,
    title,
    url,
    ...(typeof finding.summary === 'string' ? { snippet: finding.summary } : {}),
    ...(typeof finding.organization === 'string' && finding.organization.trim().length > 0
      ? { organization: finding.organization }
      : {}),
    observedAt,
  }
}

/**
 * Maps a documented research-run response to core records. The response is
 * `{ results: [...] }`; anything else is API drift and throws — a fallback
 * engine that quietly reshapes is how bad data enters the pipeline.
 */
export function mapDeeplineResponse(raw: unknown, options: { readonly nowMs: number }): RawSignalRecord[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DeeplineResponseError('expected a research-run object with a results array')
  }
  const results = (raw as { readonly results?: unknown }).results
  if (!Array.isArray(results)) {
    throw new DeeplineResponseError('expected a results array in the Deepline research-run response')
  }
  return results.map((item, index) => {
    try {
      return mapDeeplineFinding(item, index, options.nowMs)
    } catch (error) {
      if (error instanceof DeeplineResponseError || error instanceof MalformedSignalRecordError) {
        throw error
      }
      throw new DeeplineResponseError(`results[${index}] failed to map: ${String(error)}`)
    }
  })
}

export interface DeeplineHttpTransportOptions {
  /** Full endpoint URL of the documented research-run API (pinned when real keys arrive via the secrets flow). */
  readonly endpoint: string
  readonly apiKey?: string
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/** Production transport for the documented API. Auth header sent only when a key is configured. */
export function createDeeplineHttpTransport(options: DeeplineHttpTransportOptions): DeeplineTransport {
  const fetchImpl = options.fetchImpl ?? fetch
  return async (request) => {
    const response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.apiKey !== undefined ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        keywords: [...request.query.keywords],
        regions: [...request.query.regions],
        channels: [...request.channels],
        ...(request.query.maxResults !== undefined ? { maxResults: request.query.maxResults } : {}),
      }),
    })
    if (!response.ok) {
      throw new Error(`deepline research run failed: HTTP ${response.status} ${response.statusText}`)
    }
    return response.json()
  }
}

export function createDeeplineScanEngine(options: EngineOptions & { readonly transport: DeeplineTransport }): ScanEngineWithDiagnostics {
  return createScanEngineFromTransport({ ...options, engineId: 'deepline' }, async (request) => {
    const nowMs = options.now?.() ?? Date.now()
    const records = mapDeeplineResponse(await options.transport(request), { nowMs })
    const result: ResearchRunResult = { records }
    return result
  })
}
