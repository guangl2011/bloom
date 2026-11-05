import { describe, expect, it } from 'vitest'
import { createService } from './index'

describe('service-kit /health', () => {
  it('serves health status with service identity', async () => {
    const svc = createService({ name: 'test-svc', version: '0.1.0' })
    const handle = await svc.start({ port: 0, log: false })
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ status: 'ok', service: 'test-svc', version: '0.1.0' })
    } finally {
      await handle.close()
    }
  })

  it('returns 404 JSON for unknown routes', async () => {
    const svc = createService({ name: 'test-svc' })
    const handle = await svc.start({ port: 0, log: false })
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/nope`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    } finally {
      await handle.close()
    }
  })
})
