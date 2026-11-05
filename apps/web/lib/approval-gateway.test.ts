import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDecisions } from './decision-store'
import { decideApproval } from './approval-gateway'

afterEach(() => {
  resetDecisions()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const INPUT = { id: 'apr-0001', approved: true, approver: 'richard (ops)', note: 'go' }

describe('decideApproval — service path', () => {
  it('POSTs the decision to the approval service and maps the record', async () => {
    const serviceRecord = { id: 'apr-0001', approved: true, approver: 'richard (ops)', decidedAt: '2026-11-05T10:00:00Z', note: 'go' }
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://approval:4102/decisions')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(INPUT)
      return new Response(JSON.stringify(serviceRecord), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await decideApproval(INPUT, { serviceUrl: 'http://approval:4102' })
    expect(outcome).toEqual({ ...serviceRecord, via: 'approval-service' })
  })
  it('surfaces the service status instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('conflict', { status: 409 })))
    await expect(decideApproval(INPUT, { serviceUrl: 'http://approval:4102' })).rejects.toThrow('approval service returned 409')
  })
})

describe('decideApproval — local mock path (no service URL)', () => {
  it('records the decision without any external call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await decideApproval(INPUT, {})
    expect(outcome.via).toBe('local-mock')
    expect(outcome.approved).toBe(true)
    expect(outcome.decidedAt).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('throws a typed error on an already-decided request', async () => {
    await decideApproval(INPUT, {})
    await expect(decideApproval(INPUT, {})).rejects.toThrow('approval already decided')
  })
  it('throws a typed error on an unknown request id', async () => {
    await expect(decideApproval({ ...INPUT, id: 'nope' }, {})).rejects.toThrow('unknown approval request')
  })
})
