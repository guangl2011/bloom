import { describe, expect, it } from 'vitest'
import { AGENT_IDS } from '@bloom/interfaces'
import { AGENT_ROSTER } from './agents'

describe('agent roster', () => {
  it('exposes exactly the six spec agents', () => {
    expect(AGENT_ROSTER.map((agent) => agent.id)).toEqual([...AGENT_IDS])
  })

  it('gives every agent a non-empty boundary', () => {
    for (const agent of AGENT_ROSTER) {
      expect(agent.boundary.length).toBeGreaterThan(0)
    }
  })

  it('keeps outreach behind human approval', () => {
    const outreach = AGENT_ROSTER.find((agent) => agent.id === 'outreach')
    expect(outreach?.boundary).toMatch(/approval/i)
  })
})
