import { createService } from '@bloom/service-kit'

/**
 * Approval gate service (scaffold). Will own ApprovalInterface persistence and
 * the audit trail: every gate action (email_send, crm_write, ad_budget_change,
 * bulk_scan, large_export, high_cost_model_call, connect_customer_production)
 * requires a recorded human decision before execution — a hard invariant, never
 * config-off (spec locked decision 10). Gate logic lands with the approval tasks.
 */
const port = Number(process.env.PORT ?? 4102)
const service = createService({ name: 'approval' })

service.start({ port }).then((handle) => {
  process.on('SIGTERM', () => handle.close())
  process.on('SIGINT', () => handle.close())
})
