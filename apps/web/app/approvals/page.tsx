import { approvalQueueForPage } from '../../lib/data'
import { ApprovalQueue } from '../../components/ApprovalQueue'
import { SourceNote } from '../../components/ui'

// Live path: the queue must read the deployment database at request time.
// Without this, next build prerenders the fixture snapshot and the dashboard
// silently shows samples while a real stack runs (live-stack validation, 2026-11).
export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const { items, source } = await approvalQueueForPage()
  return (
    <main data-view="approvals">
      <div className="page-header">
        <h2>Approval queue</h2>
        <p className="lede">P0 gates — approve/reject lands in the audit trail; nothing executes without it</p>
      </div>
      <SourceNote source={source} />
      <ApprovalQueue initialItems={items} />
    </main>
  )
}
