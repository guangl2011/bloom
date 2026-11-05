/**
 * Approval gateway — the dashboard's single seam to the approval service
 * contract (ApprovalInterface, packages/interfaces). Approve/reject from the
 * UI lands here and nowhere else.
 *
 * Two paths:
 *  - APPROVAL_SERVICE_URL set  → POST the decision to the approval service
 *    (D3f). The service persists the decision in its audit tables and executes
 *    the gated action only after the recorded human decision.
 *  - no service URL            → local in-memory decision record (fetch-less
 *    mock). Nothing executes; the decision is visible in the queue until the
 *    process restarts.
 */
import { AlreadyDecidedError, decide, UnknownApprovalError, type DecisionRecord } from './decision-store'
import type { DecisionInput } from './decision-input'
import { knownApprovalIds } from './data'

export interface ApprovalServiceConfig {
  /** e.g. http://approval:4102 — set once D3f's HTTP surface exists. */
  serviceUrl?: string
}

export type DecisionOutcome = DecisionRecord & { via: 'approval-service' | 'local-mock' }

function authHeaders(): HeadersInit {
  return { 'content-type': 'application/json' }
}

async function decideViaService(config: ApprovalServiceConfig, input: DecisionInput): Promise<DecisionOutcome> {
  const response = await fetch(`${config.serviceUrl}/decisions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    // Surface the service's own status — a 409 (already decided) or 404 must
    // not be rewritten into a generic failure.
    throw new Error(`approval service returned ${response.status}`)
  }
  const record = (await response.json()) as Omit<DecisionOutcome, 'via'>
  return { ...record, via: 'approval-service' }
}

/**
 * Records a human decision for a gate action. Errors are typed and never
 * swallowed — the route maps them to 404/409/502.
 */
export async function decideApproval(input: DecisionInput, config: ApprovalServiceConfig): Promise<DecisionOutcome> {
  if (config.serviceUrl) {
    return decideViaService(config, input)
  }
  // Mock path — no service configured: validate the id against the known
  // queue, then record locally. An unknown id is a typed 404, never a
  // silent accept.
  if (!knownApprovalIds().includes(input.id)) {
    throw new UnknownApprovalError(input.id)
  }
  try {
    const record = decide(input.id, input)
    return { ...record, via: 'local-mock' }
  } catch (error) {
    if (error instanceof AlreadyDecidedError || error instanceof UnknownApprovalError) throw error
    throw new Error(`failed to record approval decision: ${String(error)}`)
  }
}
