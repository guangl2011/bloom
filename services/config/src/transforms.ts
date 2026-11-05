/**
 * Named transforms turning free-text intake answers into config values.
 * All pure; they never throw — validation upstream has already enforced the
 * shapes these can rely on, and anything unparseable becomes `undefined`
 * (dropped) or falls back to a package default the caller supplies.
 */
import { cadenceToCron } from './schedule.js'
import type { IntakeValue, Json } from './types.js'

export function asText(value: IntakeValue | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : value.join('；')
}

export function asPositiveInt(fallback?: number) {
  return (value: IntakeValue | undefined): number | undefined => {
    const match = /\d+/.exec(asText(value) ?? '')
    if (match === null) return fallback
    return Number(match[0])
  }
}

/** cron from a cadence answer; falls back to the package default schedule. */
export function cronFromCadence(fallback: string) {
  return (value: IntakeValue | undefined): string | undefined => {
    const text = asText(value)
    if (text === undefined || text.trim() === '') return fallback
    return cadenceToCron(text, fallback).cron
  }
}

export type ReportLanguage = 'zh' | 'en'

const LANG_PATTERNS: ReadonlyArray<{ pattern: RegExp; languages: ReportLanguage[] }> = [
  { pattern: /双语|bilingual|中英|英中/i, languages: ['zh', 'en'] },
  { pattern: /中文|chinese|zh/i, languages: ['zh'] },
  { pattern: /英文|english|\ben\b/i, languages: ['en'] },
]

export function parseLanguages(fallback: readonly ReportLanguage[] = ['zh']) {
  return (value: IntakeValue | undefined): ReportLanguage[] | undefined => {
    const text = asText(value)
    if (text === undefined || text.trim() === '') return [...fallback]
    for (const { pattern, languages } of LANG_PATTERNS) {
      if (pattern.test(text)) return [...languages]
    }
    return [...fallback]
  }
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

export function extractEmails(value: IntakeValue | undefined): Json | undefined {
  const text = asText(value)
  if (text === undefined) return undefined
  return [...text.matchAll(EMAIL_PATTERN)].map((match) => match[0])
}

/**
 * Outreach mode is a platform invariant: sends happen only after a recorded
 * human approval (spec locked decision 10). Whatever the customer answers,
 * the compiled mode is always approval_gated_send — the raw answer is kept
 * as mode_source by a sibling projection.
 */
export function approvalGatedMode(): string {
  return 'approval_gated_send'
}
