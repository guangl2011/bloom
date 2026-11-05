import { createService } from '@bloom/service-kit'

/**
 * Credit accounting service (scaffold entry). The accounting domain lives in
 * ./credits (pure) and ./ledger (reference ledger); persistence over the
 * credit_* tables wires in with the compose integration task.
 */
const port = Number(process.env.PORT ?? 4104)
const service = createService({ name: 'credits' })

service.start({ port }).then((handle) => {
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
