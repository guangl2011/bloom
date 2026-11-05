import { createService } from '@bloom/service-kit'
import { AGENT_ROSTER } from './agents'

/**
 * Agent runtime service (scaffold). Hosts the six agents behind AgentInterface;
 * in v1.0 they execute on Hermes with Obvious as the automation layer (spec
 * decision 2). Agent implementations land with the per-agent tasks.
 */
const port = Number(process.env.PORT ?? 4103)
const service = createService({ name: 'agents' })

service.start({ port }).then((handle) => {
  console.log(`[agents] roster: ${AGENT_ROSTER.map((agent) => agent.id).join(', ')}`)
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
