import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ServiceInfo {
  /** Stable service name surfaced by /health and used by compose + smoke checks. */
  name: string
  version?: string
}

export interface ServiceHandle {
  port: number
  close(): Promise<void>
}

export interface StartOptions {
  /** Port to listen on; falls back to $PORT, then 8080. Use 0 for an ephemeral port (tests). */
  port?: number
  /** Log a ready line to stdout when listening (default true). */
  log?: boolean
}

/**
 * Minimal health-check HTTP service used by every Bloom backend service.
 * Zero runtime dependencies — services boot fast and /health is uniform
 * across compose, the CI smoke test and the ops dashboard.
 */
export function createService(info: ServiceInfo) {
  const startedAt = Date.now()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        service: info.name,
        version: info.version ?? '0.0.0',
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
  })

  return {
    async start(options: StartOptions = {}): Promise<ServiceHandle> {
      const port = options.port ?? Number(process.env.PORT ?? 8080)
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '0.0.0.0', () => resolve())
      })
      const boundPort = (server.address() as AddressInfo).port
      if (options.log !== false) {
        console.log(`[${info.name}] listening on :${boundPort}`)
      }
      return {
        port: boundPort,
        close: () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          }),
      }
    },
  }
}
