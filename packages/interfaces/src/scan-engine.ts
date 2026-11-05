/**
 * ScanEngineInterface — the swappable purchase-signal scan layer (spec locked
 * decision 3). This is the canonical home of the contract:
 *
 * - Obvious is the primary research engine; Deepline is the configured fallback.
 * - Engine selection is config, never agent code — flipping `engine.primary`
 *   changes the scan path with zero agent-code edits.
 * - Visible API and general-purpose crawlers (Apify, Tinyfish) are deliberately
 *   out of this set — precision too low for purchase-signal work (v3.1 review).
 *
 * `adapters/adapter-scan-engine` implements this contract (structurally
 * identical shapes today, so the adapter needs no import).
 */

export type ScanEngineId = 'obvious' | 'deepline'

export interface ScanQuery {
  keywords: string[]
  regions: string[]
  maxResults?: number
}

export interface ScanSignal {
  title: string
  url: string
  /** Engine that produced this signal. */
  source: ScanEngineId
  snippet?: string
}

export interface ScanEngineInterface {
  readonly id: ScanEngineId
  scan(query: ScanQuery): Promise<ScanSignal[]>
}
