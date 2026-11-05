/**
 * WorkflowInterface — workflows are recordable (every run produces a record),
 * retryable (failed runs re-execute with attempt+1), and traceable (per-step
 * timing, status, and errors).
 */

import type { AgentContext, AgentResult } from './agent'
import type { AutomationTrigger } from './automation'
import type { AgentId, GateAction } from './ids'

export interface WorkflowStep {
  readonly id: string
  readonly agentId: AgentId
  /** Gate actions this step may hit; enforcement stays in the approval gate (hard invariant). */
  readonly gateActions?: readonly GateAction[]
}

export interface WorkflowDefinition {
  readonly id: string
  readonly steps: readonly WorkflowStep[]
}

export interface WorkflowStepTrace {
  readonly stepId: string
  readonly agentId: AgentId
  readonly status: 'succeeded' | 'failed' | 'skipped'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly error?: string
}

export interface WorkflowRunRecord {
  readonly runId: string
  readonly workflowId: string
  readonly workspaceId: string
  readonly trigger: AutomationTrigger
  /** 1 on first execution; +1 on every retry. */
  readonly attempt: number
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly steps: readonly WorkflowStepTrace[]
  readonly result?: AgentResult
}

export interface WorkflowInterface {
  readonly id: string
  execute(
    definition: WorkflowDefinition,
    context: AgentContext,
    trigger?: AutomationTrigger,
  ): Promise<WorkflowRunRecord>
  /** Re-executes a failed run at attempt+1; the runner retains the original context. Unknown runId is an error. */
  retry(record: WorkflowRunRecord): Promise<WorkflowRunRecord>
}
