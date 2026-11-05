/**
 * ScanEngineInterface — the swappable purchase-signal scan layer (spec decision 3).
 * Obvious is the primary research engine; Deepline is the configured fallback.
 * The engine swap point is configuration, never agent code. Visible API and
 * general-purpose crawlers (Apify, Tinyfish) are deliberately out of this set.
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

export interface ScanEngine {
  readonly id: ScanEngineId
  scan(query: ScanQuery): Promise<ScanSignal[]>
}

/**
 * Returns an engine that serves from `primary` and falls back to `fallback`
 * when the primary fails. If both engines fail, the combined error is thrown —
 * engine failures are never swallowed.
 */
export function withFallback(primary: ScanEngine, fallback: ScanEngine): ScanEngine {
  return {
    id: primary.id,
    async scan(query: ScanQuery): Promise<ScanSignal[]> {
      try {
        return await primary.scan(query)
      } catch (primaryError) {
        try {
          return await fallback.scan(query)
        } catch (fallbackError) {
          throw new Error(
            `both scan engines failed — primary (${primary.id}): ${String(primaryError)}; fallback (${fallback.id}): ${String(fallbackError)}`,
          )
        }
      }
    },
  }
}

/** Obvious-platform research run (primary). Implementation lands with the scan tasks. */
export const obviousScanEngine: ScanEngine = {
  id: 'obvious',
  scan: async () => {
    throw new Error('obvious scan engine not implemented yet (scaffold stub)')
  },
}

/** Deepline research-agent run (fallback, deepline.com/docs). Implementation lands with the scan tasks. */
export const deeplineScanEngine: ScanEngine = {
  id: 'deepline',
  scan: async () => {
    throw new Error('deepline scan engine not implemented yet (scaffold stub)')
  },
}
