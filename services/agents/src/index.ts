import { createService } from '@bloom/service-kit'
import { AGENT_IDS } from '@bloom/interfaces'

/**
 * Agent runtime service. Hosts the six agents behind AgentInterface on the
 * Hermes runtime (v1.0); Obvious scheduled tasks carry schedules, retries and
 * audit (spec locked decision 2). Agents activate per customer workflow
 * config — via activateAgents() once the config service (D3c) and the
 * reference deployment (D5) wire one in — so boot stays config-free.
 */
const port = Number(process.env.PORT ?? 4103)
const service = createService({ name: 'agents' })

service.start({ port }).then((handle) => {
  // HermesAgentRuntime activates per customer config once the config service
  // (D3c) wires activateAgents() into the request path — boot stays config-free.
  console.log(`[agents] hermes runtime ready — supported roster: ${AGENT_IDS.join(', ')}`)
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
