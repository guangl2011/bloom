/**
 * AutomationTrigger — the vocabulary Obvious scheduled tasks mirror (spec
 * locked decision 2): schedules carry rrule strings, webhooks carry none.
 * Cron, retries, and audit live on the Obvious side; this type is the contract
 * the platform mirrors onto its tasks.
 */

export type AutomationTrigger =
  | { readonly kind: 'schedule'; readonly rrule: string }
  | { readonly kind: 'webhook' }

/** Returns the problems that make a trigger unusable; an empty list means valid. */
export function automationTriggerProblems(trigger: unknown): string[] {
  if (trigger === null || typeof trigger !== 'object') {
    return ['trigger must be an object']
  }
  const { kind, rrule } = trigger as { kind?: unknown; rrule?: unknown }
  if (kind === 'webhook') {
    return []
  }
  if (kind === 'schedule') {
    if (typeof rrule !== 'string' || !rrule.includes('FREQ=')) {
      return ['schedule trigger requires an rrule string containing FREQ= (e.g. "FREQ=WEEKLY;BYDAY=MO")']
    }
    return []
  }
  return [`unknown trigger kind "${String(kind)}" — expected 'schedule' or 'webhook'`]
}
