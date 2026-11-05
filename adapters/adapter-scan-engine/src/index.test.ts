import { describe, expect, it } from 'vitest'
import { withFallback, type ScanEngine, type ScanQuery } from './index'

function engine(id: ScanEngine['id'], behavior: 'ok' | 'fail'): ScanEngine {
  return {
    id,
    scan: async (query: ScanQuery) => {
      if (behavior === 'fail') {
        throw new Error(`${id} down`)
      }
      return [
        { title: `hit from ${id}`, url: 'https://example.test', source: id, snippet: query.keywords.join(' ') },
      ]
    },
  }
}

describe('withFallback', () => {
  it('serves from the primary when healthy', async () => {
    const combined = withFallback(engine('obvious', 'ok'), engine('deepline', 'ok'))
    const signals = await combined.scan({ keywords: ['display factory'], regions: ['US'] })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.source).toBe('obvious')
  })

  it('falls back when the primary engine fails', async () => {
    const combined = withFallback(engine('obvious', 'fail'), engine('deepline', 'ok'))
    const signals = await combined.scan({ keywords: ['display factory'], regions: ['US'] })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.source).toBe('deepline')
  })

  it('surfaces a combined error when both engines fail', async () => {
    const combined = withFallback(engine('obvious', 'fail'), engine('deepline', 'fail'))
    await expect(combined.scan({ keywords: ['x'], regions: ['US'] })).rejects.toThrow(
      /primary \(obvious\).*fallback \(deepline\)/,
    )
  })
})
