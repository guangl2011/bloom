import type { ToolInterface } from '@bloom/interfaces'

/**
 * Minimal tool ports the Outreach and Conversion agents depend on. The mock
 * adapters in tools/mocks.ts satisfy these plus call recording; real adapters
 * (D5 wiring) must too. Agents depend on the port, never the mock.
 */

/** Email port — draft queuing plus approval-gated send. */
export interface EmailTools {
  readonly draft: ToolInterface
  readonly send: ToolInterface
}

/** CRM port — approval-queued writes only. */
export interface CrmTools {
  readonly write: ToolInterface
}
