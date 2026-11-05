// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CreditsView } from './CreditsView'
import { SAMPLE_CREDITS } from '../lib/fixtures'

afterEach(cleanup)

describe('CreditsView', () => {
  it('renders balance, per-tool usage breakdown, and transactions', () => {
    render(<CreditsView credits={SAMPLE_CREDITS} />)
    expect(screen.getByText(/318\.26/)).toBeTruthy()
    // breakdown rows exist for every priced tool, cost descending
    expect(screen.getByText('scan-engine')).toBeTruthy()
    expect(screen.getByText('claude-sonnet')).toBeTruthy()
    expect(screen.getByText('apollo')).toBeTruthy()
    // transactions render their kind and note
    expect(screen.getByText('weekly purchase-signal scan')).toBeTruthy()
    expect(screen.getAllByText('usage').length).toBeGreaterThan(0)
    expect(screen.getByText('topup')).toBeTruthy()
  })
  it('renders an empty state when no usage is recorded', () => {
    render(
      <CreditsView
        credits={{ ...SAMPLE_CREDITS, breakdown: [], transactions: [] }}
      />,
    )
    expect(screen.getByText(/No usage recorded yet/)).toBeTruthy()
  })
})
