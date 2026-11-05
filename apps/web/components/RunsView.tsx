import type { WorkflowRunView } from '../lib/view-models'
import { formatDuration, formatTimestamp } from '../lib/view-models'
import { EmptyState, RunStatusBadge, SectionCard } from './ui'

/** Workflow runs history — every run traceable through its audit events. */
export function RunsView({ runs }: { runs: WorkflowRunView[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState>
        No workflow runs recorded yet. Runs appear here once the agent service (D3b) starts executing scheduled
        workflows on Obvious tasks.
      </EmptyState>
    )
  }
  return (
    <SectionCard title="Workflow runs" subtitle="status · history · retries · audit trace">
      <table className="data">
        <thead>
          <tr>
            <th>Run</th>
            <th>Workflow</th>
            <th>Agent</th>
            <th>Trigger</th>
            <th>Status</th>
            <th>Started (UTC)</th>
            <th>Duration</th>
            <th>Retries</th>
            <th>Audit events</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="mono">{run.id}</td>
              <td className="mono">{run.workflowId}</td>
              <td>{run.agentId}</td>
              <td>{run.trigger}</td>
              <td>
                <RunStatusBadge status={run.status} />
              </td>
              <td>{formatTimestamp(run.startedAt)}</td>
              <td>{formatDuration(run.durationMs)}</td>
              <td>{run.retries}</td>
              <td className="mono">
                {run.auditEvents.map((event) => (
                  <div key={event.id}>
                    {event.id} · {event.kind}
                    {event.detail ? ` — ${event.detail}` : ''}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  )
}
