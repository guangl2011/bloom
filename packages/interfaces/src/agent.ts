/**
 * AgentInterface — the four mandatory interfaces' centerpiece, and the v2.0
 * swap point: Mastra replaces Hermes behind this contract without touching
 * agent consumers (spec locked decision 2).
 */

import type { ApprovalInterface } from './approval'
import type { WorkflowConfig } from './config'
import type { AgentId } from './ids'

export interface AgentContext {
  readonly workspaceId: string
  readonly input: unknown
  /** Approval gate handle — agents must route gate actions through it. */
  readonly approvals: ApprovalInterface
  /** Compiled per-customer workflow config — the behavior driver, never agent code. */
  readonly config: WorkflowConfig
  /** Run this invocation belongs to (traceability). */
  readonly runId?: string
}

export interface AgentResult {
  status: 'ok' | 'error'
  data?: unknown
  error?: string
}

export interface AgentInterface {
  readonly id: AgentId
  /** The agent's hard boundary — its "does NOT do" line from the Architecture PRD. */
  readonly boundary: string
  run(context: AgentContext): Promise<AgentResult>
}
