import { workflowRunsForPage } from '../../lib/data'
import { RunsView } from '../../components/RunsView'
import { SourceNote } from '../../components/ui'

// Live path: run history must read the deployment database at request time,
// not the fixture snapshot baked in at build time (live-stack validation).
export const dynamic = 'force-dynamic'

export default async function RunsPage() {
  const { runs, source } = await workflowRunsForPage()
  return (
    <main data-view="runs">
      <div className="page-header">
        <h2>Workflow runs</h2>
        <p className="lede">status · history · retries — every run traceable through audit events</p>
      </div>
      <SourceNote source={source} />
      <RunsView runs={runs} />
    </main>
  )
}
