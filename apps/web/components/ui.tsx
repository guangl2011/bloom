import type { ReactNode } from 'react'
import type { WorkflowRunStatus } from '../lib/view-models'

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

const RUN_STATUS_TONE: Record<WorkflowRunStatus, BadgeTone> = {
  success: 'ok',
  failed: 'danger',
  running: 'info',
  retrying: 'warn',
}

export function RunStatusBadge({ status }: { status: WorkflowRunStatus }) {
  return <Badge tone={RUN_STATUS_TONE[status]}>{status}</Badge>
}

export function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card">
      <header>
        <h3>{title}</h3>
        {subtitle ? <span className="subtitle">{subtitle}</span> : null}
      </header>
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function SourceNote({ source }: { source: 'sample' | 'service' }) {
  return (
    <p className="source-note">
      {source === 'sample'
        ? 'Sample data — approval/agent services not yet wired (D3b/D3f); fixture path, zero external sends.'
        : 'Live data from the Bloom services.'}
    </p>
  )
}
