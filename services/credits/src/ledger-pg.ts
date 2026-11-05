/**
 * SQL-backed CreditLedger over the credit tables (migration 0002). Same
 * interface and reconciliation invariants as the in-memory reference ledger —
 * the compose deployment and the e2e cycle use this one. Balances are never
 * edited in place: every delta flows through a credit_transactions row.
 */

import type { SqlExecutor } from '@bloom/db'
import type {
  CreditTransaction,
  PriceCatalog,
  UsageInput,
  UsageRecord,
  WorkspaceReconciliation,
} from './credits'
import { recordUsage, reconcileWorkspace } from './credits'
import type { CreditLedger } from './ledger'

function num(value: unknown): number {
  return Number(value)
}

/** Narrows a driver row (Record<string, unknown> at runtime) to the expected row shape. */
function asRecord<T extends object>(value: unknown): T {
  if (value === null || typeof value !== 'object') {
    throw new Error('expected a row object from the query driver')
  }
  return value as T
}

interface UsageRow {
  id: string
  workspace_id: string
  tool: string
  model: string
  units: string
  cost_credits: string
  created_at: Date | string
}

interface TransactionRow {
  id: string
  workspace_id: string
  kind: string
  delta_credits: string
  usage_record_id: string | null
  note: string | null
  created_at: Date | string
}

function usageFromRow(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    tool: row.tool,
    model: row.model,
    units: num(row.units),
    costCredits: num(row.cost_credits),
  }
}

function transactionFromRow(row: TransactionRow): CreditTransaction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind as CreditTransaction['kind'],
    deltaCredits: num(row.delta_credits),
    usageRecordId: row.usage_record_id ?? undefined,
    note: row.note ?? undefined,
  }
}

export class PgCreditLedger implements CreditLedger {
  constructor(
    private readonly exec: SqlExecutor,
    private readonly catalog: PriceCatalog,
  ) {}

  private async applyBalanceDelta(workspaceId: string, deltaCredits: number): Promise<number> {
    // The balance CHECK (>= 0) is the sufficiency guard: a usage spend that
    // would go negative fails loudly here, not silently downstream. Postgres
    // evaluates the CHECK on the proposed insert row BEFORE ON CONFLICT
    // arbitration (verified against pg 17), so a negative delta through the
    // upsert fails even when the row exists — UPDATE first, INSERT only to
    // seed a missing balance.
    const updated = await this.exec(
      `UPDATE credit_balances
       SET balance_credits = balance_credits + $2, updated_at = now()
       WHERE workspace_id = $1 AND deleted_at IS NULL
       RETURNING balance_credits`,
      [workspaceId, deltaCredits],
    )
    const updatedRow = updated.rows[0] as { balance_credits: string } | undefined
    if (updatedRow !== undefined) {
      return num(updatedRow.balance_credits)
    }
    // Seeding a missing balance: only a top-up/adjustment can create one — a
    // usage spend on a workspace with no balance row is an insufficient-funds
    // error, not a silent 0-balance seed.
    if (deltaCredits < 0) {
      throw new Error(`insufficient credits: workspace ${workspaceId} has no balance row`)
    }
    const inserted = await this.exec(
      `INSERT INTO credit_balances (workspace_id, balance_credits, created_by)
       VALUES ($1, $2, 'bloom-engine') RETURNING balance_credits`,
      [workspaceId, deltaCredits],
    )
    const insertedRow = inserted.rows[0] as { balance_credits: string }
    return num(insertedRow.balance_credits)
  }

  async recordUsage(workspaceId: string, usage: UsageInput): Promise<UsageRecord> {
    // Pricing/validation reuses the pure domain (same tests cover both ledgers).
    const priced = recordUsage({
      catalog: this.catalog,
      id: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      workspaceId,
      usage,
    })

    const usageResult = await this.exec(
      `INSERT INTO usage_records (workspace_id, tool, model, units, cost_credits, created_by)
       VALUES ($1, $2, $3, $4, $5, 'bloom-engine') RETURNING id`,
      [workspaceId, priced.record.tool, priced.record.model, priced.record.units, priced.record.costCredits],
    )
    const usageRow = usageResult.rows[0] as { id: string }

    await this.exec(
      `INSERT INTO credit_transactions (workspace_id, kind, delta_credits, usage_record_id, created_by)
       VALUES ($1, 'usage', $2, $3, 'bloom-engine')`,
      [workspaceId, -priced.record.costCredits, usageRow.id],
    )
    await this.applyBalanceDelta(workspaceId, -priced.record.costCredits)

    return {
      id: usageRow.id,
      workspaceId,
      tool: priced.record.tool,
      model: priced.record.model,
      units: priced.record.units,
      costCredits: priced.record.costCredits,
    }
  }

  private async appendOperatorTransaction(
    workspaceId: string,
    kind: 'topup' | 'adjustment',
    deltaCredits: number,
    note?: string,
  ): Promise<CreditTransaction> {
    const result = await this.exec(
      `INSERT INTO credit_transactions (workspace_id, kind, delta_credits, note, created_by)
       VALUES ($1, $2, $3, $4, 'operator') RETURNING id`,
      [workspaceId, kind, deltaCredits, note ?? null],
    )
    const row = result.rows[0] as { id: string }
    await this.applyBalanceDelta(workspaceId, deltaCredits)
    return {
      id: row.id,
      workspaceId,
      kind,
      deltaCredits,
      note,
    }
  }

  async topUp(workspaceId: string, amountCredits: number): Promise<CreditTransaction> {
    return this.appendOperatorTransaction(workspaceId, 'topup', amountCredits)
  }

  async adjust(workspaceId: string, deltaCredits: number, note: string): Promise<CreditTransaction> {
    return this.appendOperatorTransaction(workspaceId, 'adjustment', deltaCredits, note)
  }

  async getBalance(workspaceId: string): Promise<number> {
    const result = await this.exec(
      'SELECT balance_credits FROM credit_balances WHERE workspace_id = $1 AND deleted_at IS NULL',
      [workspaceId],
    )
    const row = result.rows[0] as { balance_credits: string } | undefined
    return row ? num(row.balance_credits) : 0
  }

  async reconcile(workspaceId: string): Promise<WorkspaceReconciliation> {
    const [usage, transactions, balance] = await Promise.all([
      this.exec(
        `SELECT * FROM usage_records WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
        [workspaceId],
      ),
      this.exec(
        `SELECT * FROM credit_transactions WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
        [workspaceId],
      ),
      this.getBalance(workspaceId),
    ])
    return reconcileWorkspace({
      workspaceId,
      usageRecords: usage.rows.map((row) => usageFromRow(asRecord<UsageRow>(row))),
      transactions: transactions.rows.map((row) => transactionFromRow(asRecord<TransactionRow>(row))),
      reportedBalance: balance,
    })
  }
}
