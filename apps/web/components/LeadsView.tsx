import type { LeadQualityView as LeadQualityViewModel } from '../lib/view-models'
import { formatTimestamp } from '../lib/view-models'
import { Badge, EmptyState, SectionCard } from './ui'

function poolFillPercent(view: LeadQualityViewModel): number {
  if (view.monthlyQuota <= 0) return 0
  return Math.min(100, Math.round((view.poolSize / view.monthlyQuota) * 100))
}

/** Lead quality snapshot — internal_v1 scores with scan-engine attribution. */
export function LeadsView({ leads }: { leads: LeadQualityViewModel }) {
  if (leads.poolSize === 0) {
    return (
      <EmptyState>
        The lead pool is empty. Leads appear here as the Lead agent discovers and scores companies toward the monthly
        quota.
      </EmptyState>
    )
  }
  const accuracy = leads.aTierAccuracy
  const accuracyMissing = accuracy === null
  const accuracyOk = accuracy !== null && accuracy >= leads.aTierAccuracyTarget
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Lead pool / quota</div>
          <div className="value">
            {leads.poolSize} / {leads.monthlyQuota}
          </div>
          <div className="meter" role="progressbar" aria-valuenow={leads.poolSize} aria-valuemin={0} aria-valuemax={leads.monthlyQuota}>
            <div className="meter__fill" style={{ width: `${poolFillPercent(leads)}%` }} />
          </div>
        </div>
        <div className="tile">
          <div className="label">A-tier accuracy (target ≥ {Math.round(leads.aTierAccuracyTarget * 100)}%)</div>
          <div className="value">
            {accuracyMissing ? 'no data' : `${Math.round(accuracy * 100)}%`}{' '}
            {accuracyMissing ? (
              <Badge tone="warn">unverified</Badge>
            ) : accuracyOk ? (
              <Badge tone="ok">meets target</Badge>
            ) : (
              <Badge tone="danger">below target</Badge>
            )}
          </div>
        </div>
        <div className="tile">
          <div className="label">Scoring model</div>
          <div className="value">{leads.scoringModel}</div>
        </div>
      </div>
      <SectionCard title="A / B / C tier distribution" subtitle={`scored ${formatTimestamp(leads.scoredAt)} UTC`}>
        <table className="data">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Leads</th>
            </tr>
          </thead>
          <tbody>
            {(['A', 'B', 'C'] as const).map((tier) => (
              <tr key={tier}>
                <td>
                  <Badge tone={tier === 'A' ? 'ok' : tier === 'B' ? 'info' : 'neutral'}>{tier}</Badge>
                </td>
                <td>{leads.tierCounts[tier]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
      <SectionCard title="Engine attribution" subtitle="obvious primary · deepline fallback — fallback stays exercised">
        <table className="data">
          <thead>
            <tr>
              <th>Engine</th>
              <th>Signals</th>
              <th>Leads</th>
            </tr>
          </thead>
          <tbody>
            {leads.engineAttribution.map((row) => (
              <tr key={row.engine}>
                <td className="mono">{row.engine}</td>
                <td>{row.signals}</td>
                <td>{row.leads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  )
}
