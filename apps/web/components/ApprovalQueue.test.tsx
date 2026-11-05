// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApprovalQueue } from './ApprovalQueue'
import { SAMPLE_APPROVALS } from '../lib/fixtures'

afterEach(cleanup)

const PENDING_EMAIL_SEND = SAMPLE_APPROVALS.find((item) => item.action === 'email_send')
if (!PENDING_EMAIL_SEND) throw new Error('fixtures must contain a pending email_send item')

describe('ApprovalQueue', () => {
  it('renders pending gate actions with approve/reject controls and the decision history', () => {
    render(<ApprovalQueue initialItems={SAMPLE_APPROVALS} submitDecision={vi.fn(async () => {})} />)
    expect(screen.getByText(/Pending approvals \(2\)/)).toBeTruthy()
    expect(screen.getByText(/email_send/)).toBeTruthy()
    expect(screen.getByText(/crm_write/)).toBeTruthy()
    expect(screen.getByText(/Acme Industrial GmbH/)).toBeTruthy()
    // decided fixture shows in the audit-trail table
    expect(screen.getByText('Recent decisions')).toBeTruthy()
    expect(screen.getByText('richard (ops)')).toBeTruthy()
  })

  it('moves an item out of pending after a successful approve', async () => {
    const submit = vi.fn(async () => {})
    render(<ApprovalQueue initialItems={SAMPLE_APPROVALS} submitDecision={submit} />)
    const approveButtons = screen.getAllByText('Approve')
    fireEvent.click(approveButtons[0]!)

    await waitFor(() => expect(screen.getByText(/Pending approvals \(1\)/)).toBeTruthy())
    expect(submit).toHaveBeenCalledWith({ id: PENDING_EMAIL_SEND.id, approved: true })
    // decision appears in the audit trail
    expect(screen.getAllByText('approved').length).toBeGreaterThan(0)
  })

  it('surfaces an error banner and keeps the item pending on failure', async () => {
    const submit = vi.fn(async () => {
      throw new Error('approval service returned 502')
    })
    render(<ApprovalQueue initialItems={SAMPLE_APPROVALS} submitDecision={submit} />)
    fireEvent.click(screen.getAllByText('Reject')[0]!)

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/approval service returned 502/)).toBeTruthy()
    expect(screen.getByText(/Pending approvals \(2\)/)).toBeTruthy()
  })

  it('renders an empty state when the queue is clear', () => {
    render(<ApprovalQueue initialItems={[]} submitDecision={vi.fn(async () => {})} />)
    expect(screen.getByText(/Queue is clear/)).toBeTruthy()
  })
})
