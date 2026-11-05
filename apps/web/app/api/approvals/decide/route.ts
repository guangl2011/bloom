import { parseDecisionInput } from '../../../../lib/decision-input'
import { decideApproval } from '../../../../lib/approval-gateway'
import { AlreadyDecidedError, UnknownApprovalError } from '../../../../lib/decision-store'

/**
 * Records a human approval decision for a gate action. v1.0 is single-tenant
 * (one workspace per deployment), so there is no session auth yet — workspace
 * auth arrives with the v2.0 multi-tenant data layer (docs/V2-MULTITENANT.md).
 * The decision body is untrusted input, validated before it reaches the
 * approval gateway.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const parsed = parseDecisionInput(body)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const outcome = await decideApproval(parsed.value, { serviceUrl: process.env.APPROVAL_SERVICE_URL })
    return Response.json(outcome)
  } catch (error) {
    if (error instanceof UnknownApprovalError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof AlreadyDecidedError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    // Unreachable with the mock path; guards the future service call.
    return Response.json({ error: error instanceof Error ? error.message : 'decision failed' }, { status: 502 })
  }
}
