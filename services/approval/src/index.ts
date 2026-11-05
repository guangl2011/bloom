import { createService } from '@bloom/service-kit'
import { assertSendStartupSafety } from './zero-send'

/**
 * Approval gate service entry (spec deliverable D3, locked decision 10).
 *
 * The gate domain (state machine, store, audit trail, zero-send guard) lives
 * in ./gate and ./zero-send — services/workflow and the gated adapters import
 * it directly; this entry boots the health server the compose stack gates on,
 * after asserting the zero-send guarantee: a test-mode environment that
 * carries real-provider credentials or selects a real provider refuses to
 * start.
 */
assertSendStartupSafety(process.env)

const port = Number(process.env.PORT ?? 4102)
const service = createService({ name: 'approval' })

service.start({ port }).then((handle) => {
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
