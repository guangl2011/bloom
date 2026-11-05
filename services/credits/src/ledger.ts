import {
  type CreditTransaction,
  type PriceCatalog,
  type UsageInput,
  type UsageRecord,
  type WorkspaceReconciliation,
  recordUsage,
  reconcileWorkspace,
} from './credits'

/**
 * Ledger contract for credit accounting. The in-memory implementation is the
 * reference; a SQL-backed ledger implementing this interface (over
 * `credit_balances` / `usage_records` / `credit_transactions`) lands with the
 * compose wiring — same invariants, same tests.
 */
export interface CreditLedger {
  /** Records a priced usage call; throws UnpricedUsageError when unpriced. */
  recordUsage(workspaceId: string, usage: UsageInput): Promise<UsageRecord>
  /** Operator top-up (positive delta). */
  topUp(workspaceId: string, amountCredits: number): Promise<CreditTransaction>
  /** Operator adjustment (may be negative). */
  adjust(workspaceId: string, deltaCredits: number, note: string): Promise<CreditTransaction>
  getBalance(workspaceId: string): Promise<number>
  reconcile(workspaceId: string): Promise<WorkspaceReconciliation>
}

let sequence = 0

function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}_${sequence.toString().padStart(8, '0')}`
}

/**
 * Reference in-memory ledger. Deterministic ids keep assertions readable in
 * tests; production persistence lives behind CreditLedger, not here.
 */
export class InMemoryCreditLedger implements CreditLedger {
  private readonly records = new Map<string, UsageRecord[]>()
  private readonly transactions = new Map<string, CreditTransaction[]>()

  constructor(private readonly catalog: PriceCatalog) {}

  async recordUsage(workspaceId: string, usage: UsageInput): Promise<UsageRecord> {
    const priced = recordUsage({
      catalog: this.catalog,
      id: nextId('usage'),
      transactionId: nextId('tx'),
      workspaceId,
      usage,
    })
    this.appendRecord(workspaceId, priced.record)
    this.appendTransaction(workspaceId, priced.transaction)
    return priced.record
  }

  async topUp(workspaceId: string, amountCredits: number): Promise<CreditTransaction> {
    return this.appendTransaction(
      workspaceId,
      { id: nextId('tx'), workspaceId, kind: 'topup', deltaCredits: amountCredits },
    )
  }

  async adjust(
    workspaceId: string,
    deltaCredits: number,
    note: string,
  ): Promise<CreditTransaction> {
    return this.appendTransaction(
      workspaceId,
      { id: nextId('tx'), workspaceId, kind: 'adjustment', deltaCredits, note },
    )
  }

  private appendRecord(workspaceId: string, record: UsageRecord): void {
    const existing = this.records.get(workspaceId)
    if (existing) existing.push(record)
    else this.records.set(workspaceId, [record])
  }

  private appendTransaction(
    workspaceId: string,
    transaction: CreditTransaction,
  ): CreditTransaction {
    if (!Number.isFinite(transaction.deltaCredits) || transaction.deltaCredits === 0) {
      throw new RangeError(
        `transaction delta must be non-zero and finite, got ${transaction.deltaCredits}`,
      )
    }
    const existing = this.transactions.get(workspaceId)
    if (existing) existing.push(transaction)
    else this.transactions.set(workspaceId, [transaction])
    return transaction
  }

  async getBalance(workspaceId: string): Promise<number> {
    const transactions = this.transactions.get(workspaceId) ?? []
    return transactions.reduce((total, tx) => total + tx.deltaCredits, 0)
  }

  async reconcile(workspaceId: string): Promise<WorkspaceReconciliation> {
    return reconcileWorkspace({
      workspaceId,
      usageRecords: this.records.get(workspaceId) ?? [],
      transactions: this.transactions.get(workspaceId) ?? [],
      reportedBalance: await this.getBalance(workspaceId),
    })
  }
}
