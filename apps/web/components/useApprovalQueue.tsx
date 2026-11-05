'use client'

import { useState } from 'react'
import type { ApprovalItemView } from '../lib/view-models'

export type DecideApproval = (input: { id: string; approved: boolean }) => Promise<void>

export interface ApprovalQueueState {
  items: ApprovalItemView[]
  /** Set when a decision failed — named so the UI can offer a retry. */
  error: string | null
  busyId: string | null
  decide: DecideApproval
}

/**
 * Owns the approve/reject interaction: POST to the decision API, update the
 * item in place on success, surface a typed error banner on failure (retry =
 * click the button again). All state lives here, not in the view.
 */
export function useApprovalQueue(initial: ApprovalItemView[], submitDecision: DecideApproval): ApprovalQueueState {
  const [items, setItems] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function decide({ id, approved }: { id: string; approved: boolean }): Promise<void> {
    setBusyId(id)
    setError(null)
    try {
      await submitDecision({ id, approved })
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: approved ? 'approved' : 'rejected', decidedBy: 'you (ops)' } : item,
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'decision failed — try again')
    } finally {
      setBusyId(null)
    }
  }

  return { items, error, busyId, decide }
}

/** Posts the decision to the Bloom API (which routes it through the approval gateway). */
export async function submitDecisionToApi({ id, approved }: { id: string; approved: boolean }): Promise<void> {
  const response = await fetch('/api/approvals/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, approved, approver: 'ops-dashboard' }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error ?? `decision rejected by API (HTTP ${response.status})`)
  }
}
