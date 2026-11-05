/**
 * Scan methodology — the pure purchase-signal scan core both engines share.
 * Encodes the validated AU signal-scan build (delivered and independently
 * validated 2026-10-30, conditional GO); every rule below is a lesson learned
 * the hard way there:
 *
 * - Every source normalizes to one core schema; malformed records are defects
 *   and throw — they are never silently dropped.
 * - Dedupe keys are persistent and stable: `sourcePlatform|signalType|accountKey`.
 *   The account key is the purchaser-side identity. Seller attribution flips
 *   and listing-title edits must never re-key a signal (a flipped key created
 *   16 duplicates in the AU build that had to be migrated).
 * - Segment assignment requires equipment evidence in the row itself — loose
 *   keyword matching mislabeled 199 rows in the AU build. The scan query is
 *   deliberately not an input to segmentation.
 * - Metrics read a rolling 90-day window, never full history (years of stale
 *   rows dragged every AU rate until the window was enforced).
 * - Source lag is reported as a property (a finding), never as breakage.
 */

export type ScanEngineId = 'obvious' | 'deepline'

/**
 * The plain engine contract — structurally identical to ScanEngineInterface in
 * @bloom/interfaces; the adapter keeps its local shape so the scan layer stays
 * swappable without importing the runtime contracts package.
 */
export interface ScanEngine {
  readonly id: ScanEngineId
  scan(query: ScanQuery): Promise<ScanSignal[]>
}

/** Engine contract with native run diagnostics — both in-repo engines implement it. */
export interface ScanEngineWithDiagnostics extends ScanEngine {
  scanWithDiagnostics(query: ScanQuery): Promise<ScanRunResult>
}

export interface ScanQuery {
  readonly keywords: readonly string[]
  readonly regions: readonly string[]
  readonly maxResults?: number
}

export interface ScanSignal {
  readonly title: string
  readonly url: string
  /** Engine that produced this signal. */
  readonly source: ScanEngineId
  readonly snippet?: string
}

/** Source families a customer can watch (D2 intake sheet 5, via the compiled workflow YAML). */
export type ScanChannel = 'web' | 'news' | 'tenders' | 'trade-shows'
export const SCAN_CHANNELS: readonly ScanChannel[] = ['web', 'news', 'tenders', 'trade-shows']

export const SIGNAL_TYPES = [
  'purchase_request',
  'tender_award',
  'listing',
  'expansion_signal',
  'research_finding',
] as const
export type SignalType = (typeof SIGNAL_TYPES)[number]

/**
 * The raw capture schema every engine transport maps its source into before
 * methodology applies. One shape, both engines — "normalize every source to
 * the core schema" starts at this boundary.
 */
export interface RawSignalRecord {
  /** Upstream source platform inside the engine's research run (e.g. 'machines4u', 'autender'). */
  readonly sourcePlatform: string
  readonly signalType: SignalType
  readonly title: string
  readonly url: string
  readonly snippet?: string
  /** When the signal was published or observed upstream (ISO 8601) — rolling windows and lag read this. */
  readonly observedAt: string
  /** Expected publication lag for this source, in days — reported as a property, never an error. */
  readonly expectedLagDays?: number
  /**
   * Source-native stable purchaser account identity (ABN, buyer account id).
   * Preferred over every derived form — organization slugs re-key on renames,
   * native ids do not.
   */
  readonly accountKey?: string
  /** Purchasing organization name — fallback identity. NEVER seller attribution. */
  readonly organization?: string
  /** Seller/agency attribution as the source displays it. Captured for context; must never key a signal. */
  readonly sellerAttribution?: string
  /** Extra row-internal text considered for segment assignment. */
  readonly evidence?: string
}

/** A normalized signal: the core ScanSignal contract plus the methodology fields. */
export interface NormalizedSignal {
  readonly title: string
  readonly url: string
  readonly source: ScanEngineId
  readonly snippet?: string
  readonly sourcePlatform: string
  readonly signalType: SignalType
  readonly accountKey: string
  /** Persistent state key: `sourcePlatform|signalType|accountKey` — stable across runs. */
  readonly dedupeKey: string
  /** Assigned only on in-row equipment evidence; never guessed from keywords. */
  readonly segment?: string
  readonly observedAt: string
  readonly lagDays: number
  readonly lagExceedsExpected: boolean
  /** The source's declared expected lag, carried through for diagnostics. */
  readonly expectedLagDays?: number
}

export interface SegmentRule {
  readonly segment: string
  /** Equipment/product evidence that must appear IN the row for this segment. */
  readonly evidenceTerms: readonly string[]
}

/** Thrown for malformed raw records — fixing the transport mapping is the fix, never dropping the record. */
export class MalformedSignalRecordError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000
export const MS_PER_DAY = DAY_MS

/**
 * Legal-suffix tokens stripped from the END of an organization name so
 * 'Acme Trading Co' and 'Acme Trading' key alike. Stripped repeatedly —
 * 'Acme Trading Co Ltd' reduces to 'acme-trading'.
 */
const LEGAL_SUFFIXES = new Set([
  'ab', 'ag', 'aps', 'as', 'asa', 'bv', 'co', 'company', 'corp', 'corporation',
  'gmbh', 'inc', 'kft', 'limited', 'llc', 'ltd', 'mbh', 'nv', 'oy', 'oyj',
  'plc', 'pty', 'sa', 'sas', 'sarl', 'srl', 'zrt',
])

/** Normalizes an organization name into a stable kebab-case slug. */
export function slugifyOrganization(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const tokens = slug.split('-').filter((token) => token.length > 0)
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1] ?? '')) {
    tokens.pop()
  }
  return tokens.join('-')
}

/**
 * The purchaser-side account key for a record — the third component of the
 * persistent dedupe key. Precedence: source-native id, then organization
 * slug. Seller names and listing titles must never key a signal; a record
 * with neither identity is malformed.
 */
export function signalAccountKey(record: Pick<RawSignalRecord, 'accountKey' | 'organization'>): string {
  const explicit = record.accountKey?.trim()
  if (explicit) {
    // Case-normalized so a case drift in the source id cannot re-key.
    return explicit.toLowerCase()
  }
  const organization = record.organization?.trim()
  if (organization) {
    return slugifyOrganization(organization)
  }
  throw new MalformedSignalRecordError(
    'no purchaser-side account identity (accountKey or organization) — seller attribution and listing titles must never key a signal',
  )
}

/** The persistent state key. Re-keying on seller attribution or listing edits is the defect class this prevents. */
export function signalDedupeKey(
  parts: Pick<RawSignalRecord, 'sourcePlatform' | 'signalType'> & { readonly accountKey: string },
): string {
  return `${parts.sourcePlatform}|${parts.signalType}|${parts.accountKey}`
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Evidence terms match on word boundaries; internal whitespace matches any whitespace or hyphen run. */
export function evidenceMatches(text: string, term: string): boolean {
  const pattern = term
    .trim()
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join('[\\s-]+')
  return new RegExp(`\\b${pattern}\\b`, 'i').test(text)
}

/** The row-internal text segment assignment may read: title, snippet, evidence — nothing else. */
export function rowText(record: Pick<RawSignalRecord, 'title' | 'snippet' | 'evidence'>): string {
  return [record.title, record.snippet, record.evidence].filter((part) => part !== undefined).join(' ')
}

/**
 * Segment assignment requires equipment evidence IN the row. Loose
 * keyword-to-segment matching mislabeled 199 AusTender rows in the AU build
 * and inflated fit scores — a query keyword that never appears in the row
 * must not assign a segment, which is why the query is not an input here.
 */
export function assignSegment(record: RawSignalRecord, rules: readonly SegmentRule[]): string | undefined {
  if (rules.length === 0) {
    return undefined
  }
  const text = rowText(record)
  for (const rule of rules) {
    if (rule.evidenceTerms.some((term) => evidenceMatches(text, term))) {
      return rule.segment
    }
  }
  return undefined
}

export interface NormalizeContext {
  readonly engineId: ScanEngineId
  /** Epoch ms the run treats as "now" — injected for deterministic tests. */
  readonly nowMs: number
  readonly segments?: readonly SegmentRule[]
}

/** Normalizes one raw record to the core schema. Malformed fields throw, naming the field. */
export function normalizeSignalRecord(record: RawSignalRecord, context: NormalizeContext): NormalizedSignal {
  const problems: string[] = []
  if (typeof record.sourcePlatform !== 'string' || record.sourcePlatform.trim().length === 0) {
    problems.push('sourcePlatform must be a non-empty string')
  }
  if (!SIGNAL_TYPES.includes(record.signalType)) {
    problems.push(`signalType must be one of: ${SIGNAL_TYPES.join(', ')}`)
  }
  if (typeof record.title !== 'string' || record.title.trim().length === 0) {
    problems.push('title must be a non-empty string')
  }
  if (typeof record.url === 'string') {
    try {
      const parsed = new URL(record.url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        problems.push('url must be an http(s) URL')
      }
    } catch {
      problems.push('url must be a parseable http(s) URL')
    }
  } else {
    problems.push('url must be a string')
  }
  if (typeof record.observedAt !== 'string' || Number.isNaN(Date.parse(record.observedAt))) {
    problems.push('observedAt must be an ISO 8601 timestamp')
  }
  if (record.expectedLagDays !== undefined && !(typeof record.expectedLagDays === 'number' && record.expectedLagDays >= 0)) {
    problems.push('expectedLagDays must be a non-negative number')
  }
  let accountKey: string
  try {
    accountKey = signalAccountKey(record)
  } catch {
    problems.push(
      'no purchaser-side account identity (accountKey or organization) — seller attribution and listing titles must never key a signal',
    )
    accountKey = ''
  }
  if (problems.length > 0) {
    throw new MalformedSignalRecordError(
      `malformed signal record from ${context.engineId}: ${problems.join('; ')} — fix the transport mapping; never drop records silently`,
    )
  }

  const sourcePlatform = record.sourcePlatform.trim().toLowerCase().replace(/[\s_]+/g, '-')
  const observedMs = Date.parse(record.observedAt)
  const lagDays = Math.max(0, Math.floor((context.nowMs - observedMs) / DAY_MS))
  const segment = assignSegment(record, context.segments ?? [])
  return {
    title: record.title,
    url: record.url,
    source: context.engineId,
    ...(record.snippet !== undefined ? { snippet: record.snippet } : {}),
    sourcePlatform,
    signalType: record.signalType,
    accountKey,
    dedupeKey: signalDedupeKey({ sourcePlatform, signalType: record.signalType, accountKey }),
    ...(segment !== undefined ? { segment } : {}),
    observedAt: record.observedAt,
    lagDays,
    lagExceedsExpected: record.expectedLagDays !== undefined && lagDays > record.expectedLagDays,
    ...(record.expectedLagDays !== undefined ? { expectedLagDays: record.expectedLagDays } : {}),
  }
}

export interface DedupeOutcome {
  /** Deduplicated signals, newest first (stable on title for same-timestamp ties). */
  readonly kept: readonly NormalizedSignal[]
  /** Within-run duplicates suppressed by key — the newest sighting of a key wins. */
  readonly suppressed: number
  /** Re-encounters of keys already in persistent state, dropped for the caller. */
  readonly knownSkipped: number
}

/**
 * Within-run dedupe by persistent key. Listing edits and seller-attribution
 * flips cannot produce a second entry — the key never reads those fields.
 * Pass `knownKeys` (the persistent state's key set) to drop re-encounters of
 * previously stored signals; omit it to get everything the run observed.
 */
export function dedupeSignals(signals: readonly NormalizedSignal[], knownKeys?: ReadonlySet<string>): DedupeOutcome {
  let knownSkipped = 0
  const latestByKey = new Map<string, NormalizedSignal>()
  for (const signal of signals) {
    if (knownKeys?.has(signal.dedupeKey)) {
      knownSkipped += 1
      continue
    }
    const existing = latestByKey.get(signal.dedupeKey)
    if (existing === undefined || Date.parse(signal.observedAt) > Date.parse(existing.observedAt)) {
      latestByKey.set(signal.dedupeKey, signal)
    }
  }
  const kept = [...latestByKey.values()].sort((a, b) => {
    const byTime = Date.parse(b.observedAt) - Date.parse(a.observedAt)
    return byTime !== 0 ? byTime : a.title.localeCompare(b.title)
  })
  return { kept, suppressed: signals.length - knownSkipped - kept.length, knownSkipped }
}

export const DEFAULT_WINDOW_DAYS = 90

export interface RollingWindowMetrics {
  readonly windowDays: number
  readonly windowStart: string
  readonly withinWindow: number
  readonly outsideWindow: number
  readonly bySegment: Readonly<Record<string, number>>
  readonly bySignalType: Readonly<Record<string, number>>
}

/**
 * Rolling-window metrics — counts read ONLY the window; full-history
 * aggregation is the defect class this prevents. Signals outside the window
 * stay in the run's output; they are merely excluded from these aggregates.
 */
export function rollingWindowMetrics(
  signals: readonly NormalizedSignal[],
  options: { readonly nowMs: number; readonly windowDays?: number },
): RollingWindowMetrics {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS
  const windowStartMs = options.nowMs - windowDays * DAY_MS
  const bySegment: Record<string, number> = {}
  const bySignalType: Record<string, number> = {}
  let withinWindow = 0
  let outsideWindow = 0
  for (const signal of signals) {
    if (Date.parse(signal.observedAt) < windowStartMs) {
      outsideWindow += 1
      continue
    }
    withinWindow += 1
    if (signal.segment !== undefined) {
      bySegment[signal.segment] = (bySegment[signal.segment] ?? 0) + 1
    }
    bySignalType[signal.signalType] = (bySignalType[signal.signalType] ?? 0) + 1
  }
  return {
    windowDays,
    windowStart: new Date(windowStartMs).toISOString(),
    withinWindow,
    outsideWindow,
    bySegment,
    bySignalType,
  }
}

export interface SourceDiagnostics {
  readonly records: number
  readonly emitted: number
  readonly duplicatesSuppressed: number
  readonly latestObservedAt?: string
  readonly maxLagDays?: number
  readonly expectedLagDays?: number
}

export interface ScanDiagnostics {
  readonly engineId: ScanEngineId
  readonly channels: readonly ScanChannel[]
  readonly recordsIn: number
  readonly signalsOut: number
  readonly duplicatesSuppressed: number
  readonly knownSkipped: number
  readonly perSource: Readonly<Record<string, SourceDiagnostics>>
  readonly rollingWindow: RollingWindowMetrics
  /** Properties and findings — zero-yield runs, stale sources — never failures. */
  readonly findings: readonly string[]
}

/**
 * Methodology fields carried on run-result signals when the serving engine ran
 * the shared scan core (both in-repo engines do). The plain-engine synthesis
 * path leaves them undefined rather than inventing values.
 */
export interface ScanSignalExtras {
  readonly sourcePlatform?: string
  readonly signalType?: SignalType
  readonly accountKey?: string
  readonly dedupeKey?: string
  readonly segment?: string
  readonly observedAt?: string
  readonly lagDays?: number
  readonly lagExceedsExpected?: boolean
  readonly expectedLagDays?: number
}

export interface ScanRunResult {
  readonly servedBy: ScanEngineId
  readonly signals: readonly (ScanSignal & ScanSignalExtras)[]
  readonly diagnostics: ScanDiagnostics
}

export interface FinalizeOptions {
  readonly engineId: ScanEngineId
  readonly channels: readonly ScanChannel[]
  readonly query: ScanQuery
  readonly nowMs: number
  readonly windowDays?: number
  readonly knownKeys?: ReadonlySet<string>
}

/** Mutable build-time form of SourceDiagnostics — handed out readonly once finalized. */
type MutableSourceDiagnostics = { -readonly [K in keyof SourceDiagnostics]: SourceDiagnostics[K] }

/** Assembles the run result: dedupe → newest-first ordering → cap → diagnostics with findings. */
export function finalizeScanRun(normalized: readonly NormalizedSignal[], options: FinalizeOptions): ScanRunResult {
  const outcome = dedupeSignals(normalized, options.knownKeys)
  const capped = options.query.maxResults !== undefined ? outcome.kept.slice(0, options.query.maxResults) : outcome.kept

  const perSource: Record<string, MutableSourceDiagnostics> = {}
  for (const signal of normalized) {
    const source = (perSource[signal.sourcePlatform] ??= {
      records: 0,
      emitted: 0,
      duplicatesSuppressed: 0,
    })
    source.records += 1
    if (capped.some((kept) => kept.dedupeKey === signal.dedupeKey)) {
      source.emitted += 1
    }
    if (source.latestObservedAt === undefined || Date.parse(signal.observedAt) > Date.parse(source.latestObservedAt)) {
      source.latestObservedAt = signal.observedAt
    }
    source.maxLagDays = Math.max(source.maxLagDays ?? 0, signal.lagDays)
    if (source.expectedLagDays === undefined && signal.expectedLagDays !== undefined) {
      source.expectedLagDays = signal.expectedLagDays
    }
  }
  // Within-run duplicates per source: records minus distinct keys that kept an entry.
  for (const [platform, stats] of Object.entries(perSource)) {
    const keptKeys = new Set(
      outcome.kept.filter((kept) => kept.sourcePlatform === platform).map((kept) => kept.dedupeKey),
    )
    stats.duplicatesSuppressed = stats.records - keptKeys.size
  }

  const findings: string[] = []
  if (capped.length === 0) {
    findings.push(
      'scan returned zero signals — a finding, not a failure; verify source coverage and keyword scope before escalating',
    )
  }
  for (const [platform, stats] of Object.entries(perSource)) {
    if (stats.expectedLagDays !== undefined && (stats.maxLagDays ?? 0) > stats.expectedLagDays) {
      findings.push(
        `source '${platform}' observed lag ${stats.maxLagDays} days exceeds expected ${stats.expectedLagDays} — reported as a property, not breakage`,
      )
    }
  }

  return {
    servedBy: options.engineId,
    signals: capped,
    diagnostics: {
      engineId: options.engineId,
      channels: options.channels,
      recordsIn: normalized.length,
      signalsOut: capped.length,
      duplicatesSuppressed: outcome.suppressed,
      knownSkipped: outcome.knownSkipped,
      perSource,
      rollingWindow: rollingWindowMetrics(outcome.kept, { nowMs: options.nowMs, windowDays: options.windowDays }),
      findings,
    },
  }
}
