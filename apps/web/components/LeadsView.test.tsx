// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LeadsView } from './LeadsView'
import { SAMPLE_LEADS } from '../lib/fixtures'

afterEach(cleanup)

describe('LeadsView', () => {
  it('renders quota progress, tier distribution, and engine attribution', () => {
    render(<LeadsView leads={SAMPLE_LEADS} />)
    expect(screen.getByText(/42\s*\/\s*50/)).toBeTruthy()
    expect(screen.getByText('internal_v1')).toBeTruthy()
    // accuracy against the ≥85% service commitment
    expect(screen.getByText(/89%/)).toBeTruthy()
    expect(screen.getByText('meets target')).toBeTruthy()
    // engine attribution: obvious primary, deepline fallback
    expect(screen.getByText('obvious')).toBeTruthy()
    expect(screen.getByText('deepline')).toBeTruthy()
  })
  it('flags accuracy below the target', () => {
    render(
      <LeadsView
        leads={{ ...SAMPLE_LEADS, aTierAccuracy: 0.7, aTierAccuracyTarget: 0.85 }}
      />,
    )
    expect(screen.getByText('below target')).toBeTruthy()
  })
  it('renders an empty state for an empty lead pool', () => {
    render(<LeadsView leads={{ ...SAMPLE_LEADS, poolSize: 0, tierCounts: { A: 0, B: 0, C: 0 }, engineAttribution: [] }} />)
    expect(screen.getByText(/lead pool is empty/i)).toBeTruthy()
  })
})
