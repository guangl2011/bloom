// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunsView } from './RunsView'
import { SAMPLE_RUNS } from '../lib/fixtures'

afterEach(cleanup)

describe('RunsView', () => {
  it('renders one row per run with status, retries, and audit trace', () => {
    render(<RunsView runs={SAMPLE_RUNS} />)
    expect(screen.getAllByRole('row')).toHaveLength(SAMPLE_RUNS.length + 1) // + header row
    expect(screen.getByText('run-2026-11-02-001')).toBeTruthy()
    expect(screen.getAllByText('success').length).toBe(3)
    expect(screen.getByText('retrying')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    // audit trace is visible per run
    expect(screen.getByText(/aud-1001 · workflow_started/)).toBeTruthy()
    expect(screen.getByText(/aud-1012 · gate_raised/)).toBeTruthy()
  })
  it('renders an empty state when no runs exist', () => {
    render(<RunsView runs={[]} />)
    expect(screen.getByText(/No workflow runs recorded yet/)).toBeTruthy()
  })
})
