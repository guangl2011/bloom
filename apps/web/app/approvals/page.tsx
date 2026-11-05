import { listDecisions } from '../../lib/decision-store'
import { loadApprovalQueue } from '../../lib/data'
import { ApprovalQueue } from '../../components/ApprovalQueue'
import { SourceNote } from '../../components/ui'

export default function ApprovalsPage() {
  const { items, source } = loadApprovalQueue(listDecisions())
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
