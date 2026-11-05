/**
 * Canonical payload fingerprints and binding checks (pure).
 *
 * Executions bind to the approved payload's identity fields: after a human
 * approves "send to X with subject Y", a send to Z is refused even though a
 * valid approval record exists. Fail-closed — an unmatchable field refuses.
 */

import { createHash } from 'node:crypto'

/** Recursively key-sorted JSON — equal values produce equal strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonical(value)) ?? 'null'
}

function sortForCanonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCanonical)
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const item = source[key]
      if (item !== undefined) {
        sorted[key] = sortForCanonical(item)
      }
    }
    return sorted
  }
  return value
}

/** Stable sha256 of the canonical form — identifies a payload across processes. */
export function fingerprintPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

/**
 * Every binding key must exist on the recorded payload with an equal value.
 * Keys the recorded payload does not carry refuse the match — the execution
 * may not bind to an approval that never mentioned what it binds to.
 */
export function bindingMatches(
  binding: Readonly<Record<string, unknown>>,
  recordedPayload: unknown,
): boolean {
  if (recordedPayload === null || typeof recordedPayload !== 'object' || Array.isArray(recordedPayload)) {
    return false
  }
  const recorded = recordedPayload as Record<string, unknown>
  return Object.entries(binding).every(([key, value]) => {
    return key in recorded && canonicalJson(recorded[key]) === canonicalJson(value)
  })
}
