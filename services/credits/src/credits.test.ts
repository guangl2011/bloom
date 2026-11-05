import { describe, expect, it } from 'vitest'
import {
  type PriceCatalog,
  UnpricedUsageError,
  lookupPrice,
  priceUsage,
  recordUsage,
  reconcileWorkspace,
} from './credits'
import { InMemoryCreditLedger } from './ledger'

const CATALOG: PriceCatalog = {
  // tool defaults and per-model overrides
  'scan-engine': 0.5,
  'llm-router:deepseek-v3': 0.2,
  'llm-router': 1.5,
  'email-send': 0.1,
}

describe('pricing — unpriced tool calls are rejected', () => {
  it('prices exact tool:model before the tool default', () => {
    expect(lookupPrice(CATALOG, { tool: 'llm-router', model: 'deepseek-v3', units: 10 })).toBe(0.2)
    expect(lookupPrice(CATALOG, { tool: 'llm-router', model: 'gpt-x', units: 1 })).toBe(1.5)
  })

  it('computes cost as unitPrice × units, rounded to 4 decimals', () => {
    expect(priceUsage(CATALOG, { tool: 'scan-engine', model: 'obvious', units: 3 })).toBe(1.5)
  })

  it('rejects a tool call missing from the catalog', () => {
    expect(() =>
      priceUsage(CATALOG, { tool: 'apollo-enrich', model: 'default', units: 1 }),
    ).toThrow(UnpricedUsageError)
  })

  it('rejects a model call whose only catalog entry is another model', () => {
    expect(() =>
      priceUsage({ 'llm-router:deepseek-v3': 0.2 }, { tool: 'llm-router', model: 'gpt-x', units: 1 }),
    ).toThrow(/unpriced tool call/)
  })

  it('rejects non-positive or non-finite units', () => {
    expect(() => priceUsage(CATALOG, { tool: 'scan-engine', model: 'obvious', units: 0 })).toThrow(
      RangeError,
    )
    expect(() => priceUsage(CATALOG, { tool: 'scan-engine', model: 'obvious', units: -2 })).toThrow(
      RangeError,
    )
    expect(() =>
      priceUsage(CATALOG, { tool: 'scan-engine', model: 'obvious', units: Number.NaN }),
    ).toThrow(RangeError)
  })

  it('records a usage record and its negative usage transaction as one pair', () => {
    const { record, transaction } = recordUsage({
      catalog: CATALOG,
      id: 'u1',
      transactionId: 't1',
      workspaceId: 'ws-a',
      usage: { tool: 'scan-engine', model: 'obvious', units: 4 },
    })
    expect(record.costCredits).toBe(2)
    expect(transaction).toMatchObject({
      kind: 'usage',
      deltaCredits: -2,
      usageRecordId: 'u1',
      workspaceId: 'ws-a',
    })
  })

  it('refuses to record an unpriced call (drift prevention)', async () => {
    const ledger = new InMemoryCreditLedger(CATALOG)
    await expect(
      ledger.recordUsage('ws-a', { tool: 'unknown-tool', model: 'x', units: 1 }),
    ).rejects.toThrow(UnpricedUsageError)
  })
})

describe('reconciliation — sum of usage records equals balance delta', () => {
  it('balances a topup-then-usage ledger', async () => {
    const ledger = new InMemoryCreditLedger(CATALOG)
    await ledger.topUp('ws-a', 100)
    await ledger.recordUsage('ws-a', { tool: 'scan-engine', model: 'obvious', units: 10 }) // 5.0
    await ledger.recordUsage('ws-a', { tool: 'llm-router', model: 'deepseek-v3', units: 25 }) // 5.0

    const result = await ledger.reconcile('ws-a')
    expect(result.usageCostSum).toBe(10)
    expect(result.usageDeltaSum).toBe(-10)
    expect(result.transactionDeltaSum).toBe(90)
    expect(result.reportedBalance).toBe(90)
    expect(result.balanced).toBe(true)
  })

  it('flags drift when a usage record has no matching usage transaction', () => {
    const result = reconcileWorkspace({
      workspaceId: 'ws-a',
      usageRecords: [
        { id: 'u1', workspaceId: 'ws-a', tool: 'scan-engine', model: 'obvious', units: 10, costCredits: 5 },
      ],
      // the 5-credit usage transaction is missing — only the topup landed
      transactions: [{ id: 't1', workspaceId: 'ws-a', kind: 'topup', deltaCredits: 100 }],
      reportedBalance: 100,
    })
    expect(result.usageMatches).toBe(false)
    expect(result.balanced).toBe(false)
  })

  it('flags drift when the stored balance diverges from transaction deltas', () => {
    const result = reconcileWorkspace({
      workspaceId: 'ws-a',
      usageRecords: [],
      transactions: [{ id: 't1', workspaceId: 'ws-a', kind: 'topup', deltaCredits: 100 }],
      reportedBalance: 95, // balance edited in place, or a transaction was lost
    })
    expect(result.balanceMatches).toBe(false)
    expect(result.balanced).toBe(false)
  })

  it('keeps workspaces isolated — usage in ws-b never reconciles into ws-a', async () => {
    const ledger = new InMemoryCreditLedger(CATALOG)
    await ledger.topUp('ws-a', 50)
    await ledger.recordUsage('ws-b', { tool: 'scan-engine', model: 'obvious', units: 100 }) // 50 in ws-b

    const a = await ledger.reconcile('ws-a')
    const b = await ledger.reconcile('ws-b')
    expect(a.usageCostSum).toBe(0)
    expect(a.balanced).toBe(true)
    expect(b.usageCostSum).toBe(50)
    expect(b.reportedBalance).toBe(-50)
  })

  it('balances an empty ledger at zero', async () => {
    const ledger = new InMemoryCreditLedger(CATALOG)
    const result = await ledger.reconcile('ws-empty')
    expect(result.usageCostSum).toBe(0)
    expect(result.balanced).toBe(true)
  })
})
