import { createService } from '@bloom/service-kit'
import { createPgExecutorFromUrl, loadMigrations, MigrationRunner } from '@bloom/db'
import { join } from 'node:path'

/**
 * Workflow engine service (scaffold). Will load versioned per-customer workflow
 * configs and drive agent pipelines; recurring schedules live on Obvious
 * scheduled tasks (spec decision 2). Pipeline logic lands with the workflow tasks.
 */
const port = Number(process.env.PORT ?? 4101)
const service = createService({ name: 'workflow' })

/**
 * Apply the versioned schema migrations on boot (idempotent). Every fresh
 * deployment — compose local or cloud — starts from an empty database, and
 * the dashboard's live readers 500 on missing tables, so the deployment's
 * first workflow service boot brings the schema up. The runner is a no-op
 * when the schema is current.
 */
async function migrateOnBoot(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return
  const { exec } = createPgExecutorFromUrl(databaseUrl)
  const migrations = await loadMigrations(join(import.meta.dirname, '../../../packages/db/migrations'))
  await new MigrationRunner((sql) => exec(sql)).run(migrations)
}

migrateOnBoot()
  .then(() => service.start({ port }))
  .then((handle) => {
    process.on('SIGTERM', () => handle.close())
    process.on('SIGINT', () => handle.close())
  })
  .catch((error) => {
    console.error('[workflow] migration boot failed', error)
    process.exit(1)
  })
