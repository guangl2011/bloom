'use client'

import type { ApprovalItemView } from '../lib/view-models'
import { formatTimestamp } from '../lib/view-models'
import { Badge, EmptyState, SectionCard } from './ui'
import { useApprovalQueue, submitDecisionToApi, type DecideApproval } from './useApprovalQueue'

/**
 * The approval console — where every hard gate (email_send, crm_write, …)
 * waits for a named human decision. Approve/reject posts through the approval
 * gateway; nothing executes without the recorded decision (spec locked
 * decision 10).
 */
export function ApprovalQueue({
  initialItems,
  submitDecision = submitDecisionToApi,
}: {
  initialItems: ApprovalItemView[]
  submitDecision?: DecideApproval
}) {
  const { items, error, busyId, decide } = useApprovalQueue(initialItems, submitDecision)

  const pending = items.filter((item) => item.status === 'pending')
  const decided = items.filter((item) => item.status !== 'pending')

  return (
    <>
      {error ? <div className="error-banner" role="alert">Decision failed: {error} — click the button again to retry.</div> : null}
      <SectionCard title={`Pending approvals (${pending.length})`} subtitle="P0 gates — nothing executes without a recorded human decision">
        {pending.length === 0 ? (
          <EmptyState>Queue is clear — no gate actions are waiting for a decision.</EmptyState>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Action</th>
                <th>Reason</th>
                <th>Requested by</th>
                <th>Requested (UTC)</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Badge tone="danger">{item.action}</Badge>
                    {item.runId ? (
                      <div className="mono">
                        run: {item.runId}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {item.reason}
                    <div className="mono">{item.payloadSummary}</div>
                  </td>
                  <td>{item.requestedBy}</td>
                  <td>{formatTimestamp(item.requestedAt)}</td>
                  <td>
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="approve"
                        disabled={busyId === item.id}
                        onClick={() => void decide({ id: item.id, approved: true })}
                      >
                        {busyId === item.id ? 'Recording…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="reject"
                        disabled={busyId === item.id}
                        onClick={() => void decide({ id: item.id, approved: false })}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
      {decided.length > 0 ? (
        <SectionCard title="Recent decisions" subtitle="audit trail — agent, action, approver, decision">
          <table className="data">
            <thead>
              <tr>
                <th>Action</th>
                <th>Reason</th>
                <th>Decision</th>
                <th>Approver</th>
                <th>Decided (UTC)</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Badge tone="neutral">{item.action}</Badge>
                  </td>
                  <td>{item.reason}</td>
                  <td>
                    <Badge tone={item.status === 'approved' ? 'ok' : 'warn'}>{item.status}</Badge>
                  </td>
                  <td>{item.decidedBy ?? '—'}</td>
                  <td>{item.decidedAt ? formatTimestamp(item.decidedAt) : '—'}</td>
                  <td>{item.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}
    </>
  )
}
