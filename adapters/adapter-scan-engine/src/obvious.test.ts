import { describe, expect, it } from 'vitest'
import { createObviousScanEngine, type ObviousResearchRequest, type ObviousResearchTransport } from './obvious'
import { MalformedSignalRecordError, type RawSignalRecord } from './methodology'

const NOW_MS = Date.parse('2026-11-05T00:00:00Z')
const QUERY = { keywords: ['display rack'], regions: ['EU'], maxResults: 10 }

function fixtureRecords(): RawSignalRecord[] {
  return [
    {
      sourcePlatform: 'display-wholesale-portal',
      signalType: 'purchase_request',
      title: 'Retail group sourcing display racks',
      url: 'https://buyer.example/rfq',
      observedAt: '2026-10-20T00:00:00Z',
      organization: 'Acme Retail Group',
    },
    {
      sourcePlatform: 'trade-show-directory',
      signalType: 'expansion_signal',
      title: 'Acme Retail Group exhibiting at EuroShop',
      url: 'https://directory.example/euroshop',
      observedAt: '2026-10-25T00:00:00Z',
      organization: 'Acme Retail Group',
    },
  ]
}

describe('createObviousScanEngine', () => {
  it('runs the platform transport and returns normalized signals with diagnostics', async () => {
    const requests: ObviousResearchRequest[] = []
    const transport: ObviousResearchTransport = async (request) => {
      requests.push(request)
      return { records: fixtureRecords() }
    }
    const engine = createObviousScanEngine({ transport, now: () => NOW_MS })
    const run = await engine.scanWithDiagnostics(QUERY)

    expect(engine.id).toBe('obvious')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.query).toEqual(QUERY)
    expect(requests[0]?.channels).toEqual(['web', 'news', 'tenders', 'trade-shows'])
    expect(run.servedBy).toBe('obvious')
    expect(run.signals).toHaveLength(2)
    expect(run.diagnostics.recordsIn).toBe(2)
    expect(run.diagnostics.engineId).toBe('obvious')
    // both fixture records are the same purchaser through different source platforms
    expect(run.signals.every((signal) => signal.accountKey === 'acme-retail-group')).toBe(true)
  })

  it('caps by maxResults and skips keys already in persistent state', async () => {
    const transport: ObviousResearchTransport = async () => ({ records: fixtureRecords() })
    const engine = createObviousScanEngine({
      transport,
      now: () => NOW_MS,
      knownKeys: new Set(['trade-show-directory|expansion_signal|acme-retail-group']),
    })
    const run = await engine.scanWithDiagnostics({ ...QUERY, maxResults: 5 })
    expect(run.signals).toHaveLength(1)
    expect(run.diagnostics.knownSkipped).toBe(1)
    expect(run.diagnostics.signalsOut).toBe(1)
  })

  it('propagates transport failures — the composition runtime owns failover', async () => {
    const transport: ObviousResearchTransport = async () => {
      throw new Error('platform research runner down')
    }
    const engine = createObviousScanEngine({ transport, now: () => NOW_MS })
    await expect(engine.scan(QUERY)).rejects.toThrow('platform research runner down')
  })

  it('surfaces malformed records as defects, never silent drops', async () => {
    const transport: ObviousResearchTransport = async () => ({
      records: [{ ...fixtureRecords()[0]!, title: '', organization: 'Acme' }],
    })
    const engine = createObviousScanEngine({ transport, now: () => NOW_MS })
    await expect(engine.scan(QUERY)).rejects.toThrow(MalformedSignalRecordError)
  })
})
