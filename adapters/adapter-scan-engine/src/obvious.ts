/**
 * Obvious platform research engine — the PRIMARY scan engine (spec locked
 * decision 3). A "platform research run" is executed by the Obvious runtime
 * hosting this deployment; the transport seam below is that edge. It is
 * injected so tests never touch a live platform, and so the v2.0 runtime
 * upgrade stays config-level at this boundary.
 *
 * The transport returns raw records already mapped to the core capture schema
 * (RawSignalRecord); normalization, dedupe, segmentation, windows, and
 * diagnostics are shared methodology.
 */

import { createScanEngineFromTransport, type EngineOptions, type ResearchRunResult, type ScanTransportRequest } from './engine-core.js'
import { type ScanEngineWithDiagnostics } from './methodology.js'

/** The platform research-run request — the engine's transport shape, named for this edge. */
export type ObviousResearchRequest = ScanTransportRequest

/** The platform research-run seam — injected; tests pass mocks, deployment wiring passes the platform runner. */
export type ObviousResearchTransport = (request: ObviousResearchRequest) => Promise<ResearchRunResult>

export function createObviousScanEngine(options: EngineOptions & { readonly transport: ObviousResearchTransport }): ScanEngineWithDiagnostics {
  return createScanEngineFromTransport({ ...options, engineId: 'obvious' }, options.transport)
}
