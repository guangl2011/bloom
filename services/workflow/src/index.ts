import { createService } from '@bloom/service-kit'

/**
 * Workflow engine service (scaffold). Will load versioned per-customer workflow
 * configs and drive agent pipelines; recurring schedules live on Obvious
 * scheduled tasks (spec decision 2). Pipeline logic lands with the workflow tasks.
 */
const port = Number(process.env.PORT ?? 4101)
const service = createService({ name: 'workflow' })

service.start({ port }).then((handle) => {
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
