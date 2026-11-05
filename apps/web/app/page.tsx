import Link from 'next/link'
import { loadCredits, loadApprovalQueue, loadLeadQuality, loadWorkflowRuns } from '../lib/data'
import { formatCredits } from '../lib/view-models'

/**
 * Overview — the four ops surfaces at a glance. Data comes through the
 * dashboard seam (fixture path until D3b/D3f wire their services).
 */
export default function OverviewPage() {
  const { runs } = loadWorkflowRuns()
  const { items: approvals } = loadApprovalQueue([])
  const { credits } = loadCredits()
  const { leads } = loadLeadQuality()

  const pendingApprovals = approvals.filter((item) => item.status === 'pending').length
  const failedRuns = runs.filter((run) => run.status === 'failed' || run.status === 'retrying').length

  return (
    <main data-view="overview">
      <div className="page-header">
        <h2>Ops overview</h2>
        <p className="lede">Reference deployment · Lead Generation Pro</p>
      </div>
      <div className="tiles">
        <div className="tile">
          <div className="label">Pending approvals</div>
          <div className="value">
            {pendingApprovals} · <Link href="/approvals">queue</Link>
          </div>
        </div>
        <div className="tile">
          <div className="label">Credit balance</div>
          <div className="value">{formatCredits(credits.balanceCredits)}</div>
        </div>
        <div className="tile">
          <div className="label">Lead pool / quota</div>
          <div className="value">
            {leads.poolSize} / {leads.monthlyQuota} · <Link href="/leads">quality</Link>
          </div>
        </div>
        <div className="tile">
          <div className="label">Runs needing attention</div>
          <div className="value">
            {failedRuns} · <Link href="/runs">history</Link>
          </div>
        </div>
      </div>
      <section className="card">
        <header>
          <h3>Agent roster</h3>
          <span className="subtitle">package-driven activation — agents exist only if the service package bought them</span>
        </header>
        <ul>
          <li>
            <strong>Revenue Intelligence</strong> — market map, competitor scan, purchase signals
          </li>
          <li>
            <strong>ICP</strong> — per-customer lead-scoring model tuning
          </li>
          <li>
            <strong>Lead</strong> — lead discovery to the monthly quota
          </li>
          <li>
            <strong>Outreach</strong> — approval-gated email sequences
          </li>
          <li>
            <strong>Ad</strong> — read-only Google Ads / LinkedIn Ads recommendations
          </li>
          <li>
            <strong>Conversion</strong> — opportunity tracking via approval-queued CRM writes
          </li>
        </ul>
        <p>
          Health endpoint: <code>/health</code>
        </p>
      </section>
    </main>
  )
}
