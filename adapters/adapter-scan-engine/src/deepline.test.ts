import { describe, expect, it } from 'vitest'
import {
  DeeplineResponseError,
  createDeeplineHttpTransport,
  createDeeplineScanEngine,
  mapDeeplineFinding,
  mapDeeplineResponse,
} from './deepline'

const NOW_MS = Date.parse('2026-11-05T00:00:00Z')

describe('mapDeeplineFinding', () => {
  it('maps a documented finding to the core capture schema with defaults', () => {
    const record = mapDeeplineFinding(
      {
        title: 'Acme Retail sourcing shelving',
        url: 'https://example.com/rfq',
        summary: 'RFQ posted for 40 stores',
        organization: 'Acme Retail Group',
        signalType: 'purchase_request',
        publishedAt: '2026-10-20T00:00:00Z',
      },
      0,
      NOW_MS,
    )
    expect(record.sourcePlatform).toBe('deepline')
    expect(record.signalType).toBe('purchase_request')
    expect(record.title).toBe('Acme Retail sourcing shelving')
    expect(record.snippet).toBe('RFQ posted for 40 stores')
    expect(record.organization).toBe('Acme Retail Group')
    expect(record.observedAt).toBe('2026-10-20T00:00:00Z')
  })

  it('defaults the signal type and observation time; keeps a per-result source name when present', () => {
    const record = mapDeeplineFinding(
      { title: 'T', url: 'https://example.com/t', sourcePlatform: ' Trade Portal ' },
      0,
      NOW_MS,
    )
    expect(record.signalType).toBe('research_finding')
    expect(record.observedAt).toBe(new Date(NOW_MS).toISOString())
    expect(record.sourcePlatform).toBe('Trade Portal')
  })

  it('throws naming the result index and field on missing required strings', () => {
    expect(() => mapDeeplineFinding({ url: 'https://example.com/t' }, 2, NOW_MS)).toThrow(/results\[2\]\.title/)
    expect(() => mapDeeplineFinding({ title: 'T' }, 0, NOW_MS)).toThrow(/results\[0\]\.url/)
  })

  it('throws on unknown signal types and unparseable dates — drift never becomes data', () => {
    expect(() => mapDeeplineFinding({ title: 'T', url: 'https://example.com/t', signalType: 'twitter_post' }, 0, NOW_MS)).toThrow(
      /not one of:/,
    )
    expect(() => mapDeeplineFinding({ title: 'T', url: 'https://example.com/t', publishedAt: 'recently' }, 0, NOW_MS)).toThrow(
      /publishedAt/,
    )
  })
})

describe('mapDeeplineResponse', () => {
  it('maps a results array', () => {
    const records = mapDeeplineResponse(
      { results: [{ title: 'A', url: 'https://example.com/a' }, { title: 'B', url: 'https://example.com/b' }] },
      { nowMs: NOW_MS },
    )
    expect(records).toHaveLength(2)
  })

  it('rejects any non-conforming response shape loudly', () => {
    expect(() => mapDeeplineResponse(null, { nowMs: NOW_MS })).toThrow(DeeplineResponseError)
    expect(() => mapDeeplineResponse([1, 2], { nowMs: NOW_MS })).toThrow(/results array/)
    expect(() => mapDeeplineResponse({ data: [] }, { nowMs: NOW_MS })).toThrow(/results array/)
  })

  it('propagates the per-finding error, not a double wrap', () => {
    expect(() => mapDeeplineResponse({ results: [{ title: 5 }] }, { nowMs: NOW_MS })).toThrow(DeeplineResponseError)
  })
})

describe('createDeeplineHttpTransport', () => {
  it('posts the query to the configured endpoint and its payload flows through the response mapper', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init: init ?? {} }
      return new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://example.com/a' }] }), { status: 200 })
    }
    const transport = createDeeplineHttpTransport({ endpoint: 'https://api.deepline.example/v1/research', apiKey: 'k', fetchImpl })
    const payload = await transport({ query: { keywords: ['shelving'], regions: ['EU'] }, channels: ['web', 'news'] })
    expect(seen?.url).toBe('https://api.deepline.example/v1/research')
    expect(seen?.init.method).toBe('POST')
    expect((seen?.init.headers as Record<string, string>)?.authorization).toBe('Bearer k')
    expect(JSON.parse(String(seen?.init.body))).toEqual({ keywords: ['shelving'], regions: ['EU'], channels: ['web', 'news'] })
    // production chain: transport returns the raw payload; the engine maps it through mapDeeplineResponse
    const records = mapDeeplineResponse(payload, { nowMs: NOW_MS })
    expect(records).toHaveLength(1)
  })

  it('omits the auth header when no key is configured and fails loudly on non-ok responses', async () => {
    const fetchImpl: typeof fetch = async () => new Response('unauthorized', { status: 401 })
    const transport = createDeeplineHttpTransport({ endpoint: 'https://api.deepline.example/v1/research', fetchImpl })
    await expect(transport({ query: { keywords: [], regions: [] }, channels: [] })).rejects.toThrow(/401/)
    let headers: Record<string, string> | undefined
    const okFetch: typeof fetch = async (_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }
    const anonymous = createDeeplineHttpTransport({ endpoint: 'https://api.deepline.example/v1/research', fetchImpl: okFetch })
    await anonymous({ query: { keywords: [], regions: [] }, channels: [] })
    expect(headers?.authorization).toBeUndefined()
  })
})

describe('createDeeplineScanEngine', () => {
  it('is the fallback engine on the same interface, serving normalized runs with diagnostics', async () => {
    const transport = async () => ({
      results: [{ title: 'Acme Retail sourcing shelving', url: 'https://example.com/rfq', organization: 'Acme Retail Group' }],
    })
    const engine = createDeeplineScanEngine({ transport, now: () => NOW_MS })
    expect(engine.id).toBe('deepline')
    const run = await engine.scanWithDiagnostics({ keywords: ['shelving'], regions: ['EU'] })
    expect(run.servedBy).toBe('deepline')
    expect(run.signals).toHaveLength(1)
    expect(run.diagnostics.engineId).toBe('deepline')
    expect(run.signals[0]?.accountKey).toBe('acme-retail-group')
  })
})
