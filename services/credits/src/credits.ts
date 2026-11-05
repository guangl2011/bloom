/**
 * Internal credit accounting (spec deliverable D3, locked decision 4 adjacent).
 * Customers never see billing — balances and usage are the operator's cost
 * accounting per single-tenant deployment.
 *
 * Domain rules (CI-tested):
 *  - Every tool/model call records a usage record, priced from the
 *    deployment's price catalog. An unpriced call is rejected, never
 *    silently recorded — unpriced usage is exactly how cost tracking drifts.
 *  - Every usage record produces a `usage` transaction (negative delta).
 *    Balances are never edited in place; they move only through transactions.
 *  - Reconciliation: sum of usage-record costs equals the sum of `usage`
 *    transaction deltas, and the reported balance equals the sum of all
 *    transaction deltas. Drift in either is a P0 (spec Layer-2 test).
 */

/** Price catalog: `tool:model` overrides the `tool` default. Per-customer config. */
export type PriceCatalog = Readonly<Record<string, number>>

export interface UsageInput {
  readonly tool: string
  readonly model: string
  readonly units: number
}

/** A priced tool/model call — mirrors `usage_records` in the data layer. */
export interface UsageRecord {
  readonly id: string
  readonly workspaceId: string
  readonly tool: string
  readonly model: string
  readonly units: number
  readonly costCredits: number
}

export type TransactionKind = 'usage' | 'topup' | 'adjustment'

/** A balance delta — mirrors `credit_transactions` in the data layer. */
export interface CreditTransaction {
  readonly id: string
  readonly workspaceId: string
  readonly kind: TransactionKind
  readonly deltaCredits: number
  /** Set for `kind: 'usage'` — the priced call that produced this delta. */
  readonly usageRecordId?: string
  /** Operator note on `topup` / `adjustment` transactions. */
  readonly note?: string
}

/** Error thrown when a tool/model call has no catalog price. */
export class UnpricedUsageError extends Error {
  constructor(
    public readonly tool: string,
    public readonly model: string,
  ) {
    super(`unpriced tool call: tool="${tool}" model="${model}" — add it to the price catalog before recording usage`)
    this.name = 'UnpricedUsageError'
  }
}

function catalogKey(tool: string, model: string): string {
  return `${tool}:${model}`
}

/**
 * Prices a usage call against the catalog: exact `tool:model` first, then the
 * tool default. Returns undefined when the call is unpriced — callers must
 * reject it (see `priceUsage`), because an unpriced call would break the
 * reconciliation invariant "sum of usage records equals balance delta".
 */
export function lookupPrice(
  catalog: PriceCatalog,
  usage: UsageInput,
): number | undefined {
  const exact = catalog[catalogKey(usage.tool, usage.model)]
  if (exact !== undefined) return exact
  return catalog[usage.tool]
}

/** Priced cost in credits for a call; throws on unpriced tool/model calls. */
export function priceUsage(catalog: PriceCatalog, usage: UsageInput): number {
  const unitPrice = lookupPrice(catalog, usage)
  if (unitPrice === undefined) {
    throw new UnpricedUsageError(usage.tool, usage.model)
  }
  if (!Number.isFinite(usage.units) || usage.units <= 0) {
    throw new RangeError(`usage units must be a positive number, got ${usage.units}`)
  }
  return round4(unitPrice * usage.units)
}

/** Builds the usage record + its `usage` transaction as one atomic pair. */
export function recordUsage(input: {
  catalog: PriceCatalog
  id: string
  transactionId: string
  workspaceId: string
  usage: UsageInput
}): { record: UsageRecord; transaction: CreditTransaction } {
  const costCredits = priceUsage(input.catalog, input.usage)
  const record: UsageRecord = {
    id: input.id,
    workspaceId: input.workspaceId,
    tool: input.usage.tool,
    model: input.usage.model,
    units: input.usage.units,
    costCredits,
  }
  const transaction: CreditTransaction = {
    id: input.transactionId,
    workspaceId: input.workspaceId,
    kind: 'usage',
    deltaCredits: -costCredits,
    usageRecordId: record.id,
  }
  return { record, transaction }
}

export interface WorkspaceLedgerSnapshot {
  /** Live (non-deleted) usage records for this workspace only. */
  readonly usageRecords: readonly UsageRecord[]
  /** Live (non-deleted) transactions for this workspace only. */
  readonly transactions: readonly CreditTransaction[]
  /** The stored `credit_balances.balance_credits` value, if a row exists. */
  readonly reportedBalance: number | undefined
}

export interface WorkspaceReconciliation {
  readonly workspaceId: string
  readonly usageCostSum: number
  /** Sum of `usage` transaction deltas — negative by construction. */
  readonly usageDeltaSum: number
  /** Sum of all transaction deltas — what the balance should equal. */
  readonly transactionDeltaSum: number
  readonly reportedBalance: number | undefined
  readonly usageMatches: boolean
  readonly balanceMatches: boolean
  readonly balanced: boolean
}

const EPSILON = 1e-9

function sum(values: readonly number[]): number {
  return round4(values.reduce((total, value) => total + value, 0))
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Reconciles one workspace's ledger. Soft-deleted rows are excluded upstream:
 * callers pass only live rows, matching the SQL reconciliation's
 * `WHERE deleted_at IS NULL` filter. Cross-workspace rows never enter the
 * snapshot — a workspace's balance can only be explained by its own records.
 */
export function reconcileWorkspace(snapshot: {
  workspaceId: string
} & WorkspaceLedgerSnapshot): WorkspaceReconciliation {
  const { workspaceId, usageRecords, transactions, reportedBalance } = snapshot

  const usageCostSum = sum(usageRecords.map((record) => record.costCredits))
  const usageDeltaSum = sum(
    transactions.filter((tx) => tx.kind === 'usage').map((tx) => tx.deltaCredits),
  )
  const transactionDeltaSum = sum(transactions.map((tx) => tx.deltaCredits))

  const usageMatches = Math.abs(usageCostSum + usageDeltaSum) < EPSILON
  const balanceMatches =
    reportedBalance !== undefined && Math.abs(reportedBalance - transactionDeltaSum) < EPSILON

  return {
    workspaceId,
    usageCostSum,
    usageDeltaSum,
    transactionDeltaSum,
    reportedBalance,
    usageMatches,
    balanceMatches,
    balanced: usageMatches && balanceMatches,
  }
}
