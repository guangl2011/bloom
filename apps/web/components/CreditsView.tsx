import type { CreditsView as CreditsViewModel } from '../lib/view-models'
import { formatCredits, formatTimestamp } from '../lib/view-models'
import { Badge, EmptyState, SectionCard } from './ui'

/** Credit balance + usage breakdown — internal cost accounting, never customer-facing. */
export function CreditsView({ credits }: { credits: CreditsViewModel }) {
  if (credits.breakdown.length === 0) {
    return (
      <EmptyState>
        No usage recorded yet. Credits appear here once the credits service is wired and agents start pricing tool and
        model calls.
      </EmptyState>
    )
  }
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Balance</div>
          <div className="value">{formatCredits(credits.balanceCredits)} credits</div>
        </div>
        <div className="tile">
          <div className="label">Period</div>
          <div className="value">{credits.periodLabel}</div>
        </div>
        <div className="tile">
          <div className="label">Workspace</div>
          <div className="value">{credits.workspaceId}</div>
        </div>
      </div>
      <SectionCard title="Usage breakdown" subtitle="priced tool/model calls, cost descending">
        <table className="data">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Model</th>
              <th>Calls</th>
              <th>Units</th>
              <th>Cost (credits)</th>
            </tr>
          </thead>
          <tbody>
            {credits.breakdown.map((row) => (
              <tr key={`${row.tool}:${row.model}`}>
                <td className="mono">{row.tool}</td>
                <td className="mono">{row.model}</td>
                <td>{row.calls}</td>
                <td>{row.units}</td>
                <td>{formatCredits(row.costCredits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
      <SectionCard title="Recent transactions" subtitle="balances move only through transactions — never edited in place">
        <table className="data">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Kind</th>
              <th>Delta</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {credits.transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{formatTimestamp(tx.createdAt)}</td>
                <td>
                  <Badge tone={tx.kind === 'usage' ? 'neutral' : 'info'}>{tx.kind}</Badge>
                </td>
                <td>{formatCredits(tx.deltaCredits)}</td>
                <td>{tx.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  )
}
