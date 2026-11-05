/**
 * Customer cadence answers are free text ("每周一 06:00", "每月 1 日前"). The
 * compiler translates the patterns it can express as a 5-field cron and falls
 * back to the package default otherwise — the raw answer is always preserved
 * alongside as `schedule_source`, so nothing the customer wrote is silently
 * lost. Ops review the schedule_source before activation (onboarding flow,
 * spec: human review of the generated workflow config is approval-gated).
 */
export interface CadenceParse {
  readonly cron: string
  readonly matched: boolean
}

const WEEKDAY_CN: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

const WEEKDAY_EN: Readonly<Record<string, number>> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseWeekday(text: string): number | undefined {
  const cn = /周([一二三四五六日天])|星期([一二三四五六日天])/.exec(text)
  const cnChar = cn?.[1] ?? cn?.[2]
  if (cnChar !== undefined) return WEEKDAY_CN[cnChar]
  const numeric = /周([1-7])/.exec(text)
  if (numeric?.[1] !== undefined) return Number(numeric[1]) % 7
  const en = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i.exec(text)
  if (en?.[1] !== undefined) return WEEKDAY_EN[en[1].toLowerCase()]
  return undefined
}

function parseTime(text: string): { hour: number; minute: number } {
  const clock = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(text)
  if (clock?.[1] !== undefined && clock?.[2] !== undefined) {
    return { hour: clamp(Number(clock[1]), 0, 23), minute: clamp(Number(clock[2]), 0, 59) }
  }
  const spoken = /(\d{1,2})\s*[点时]/.exec(text)
  if (spoken?.[1] !== undefined) {
    return { hour: clamp(Number(spoken[1]), 0, 23), minute: 0 }
  }
  return { hour: 6, minute: 0 }
}

/**
 * Translate a cadence answer into a 5-field cron. Unmatched answers (biweekly
 * is not expressible in 5-field cron, or unrecognized text) return the
 * fallback with matched: false so the caller can preserve the raw answer.
 */
export function cadenceToCron(answer: string, fallback: string): CadenceParse {
  const text = answer.trim()
  if (!text) return { cron: fallback, matched: false }
  if (/每两周|biweekly/i.test(text)) return { cron: fallback, matched: false }

  const { hour, minute } = parseTime(text)
  if (/每周|weekly|every week/i.test(text)) {
    const day = parseWeekday(text) ?? 1
    return { cron: `${minute} ${hour} * * ${day}`, matched: true }
  }
  if (/每月|monthly|every month/i.test(text)) {
    const dom = /(\d{1,2})\s*[日号]/.exec(text)
    const day = dom?.[1] !== undefined ? clamp(Number(dom[1]), 1, 28) : 1
    return { cron: `${minute} ${hour} ${day} * *`, matched: true }
  }
  return { cron: fallback, matched: false }
}
