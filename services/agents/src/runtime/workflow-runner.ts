import type {
  AgentContext,
  AutomationTrigger,
  WorkflowDefinition,
  WorkflowInterface,
  WorkflowRunRecord,
  WorkflowStepTrace,
} from '@bloom/interfaces'
import type { HermesAgentRuntime } from './hermes'

export interface SequentialWorkflowRunnerOptions {
  readonly now?: () => Date
  readonly newId?: () => string
}

interface PendingRun {
  readonly definition: WorkflowDefinition
  readonly context: AgentContext
  readonly trigger: AutomationTrigger
}

/**
 * Reference WorkflowInterface implementation on top of the Hermes runtime:
 * executes a definition's steps in order, tracing every step. Recordable (a
 * run record per execution), retryable (failed runs re-execute at attempt+1),
 * and traceable (per-step timing, status, and errors). The workflow engine
 * service (services/workflow) owns persistence of these records; this runner
 * is the execution semantics they can adopt.
 */
export class SequentialWorkflowRunner implements WorkflowInterface {
  readonly id = 'sequential-v1'

  private readonly hermes: HermesAgentRuntime
  private readonly now: () => Date
  private readonly newId: () => string
  /** Original runs by runId so failed workflows can be retried (v1 is in-memory). */
  private readonly pending = new Map<string, PendingRun>()

  constructor(hermes: HermesAgentRuntime, options: SequentialWorkflowRunnerOptions = {}) {
    this.hermes = hermes
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  async execute(
    definition: WorkflowDefinition,
    context: AgentContext,
    trigger: AutomationTrigger = { kind: 'webhook' },
  ): Promise<WorkflowRunRecord> {
    return this.executeAttempt(definition, context, trigger, 1)
  }

  async retry(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    if (record.status !== 'failed') {
      throw new Error(`run ${record.runId} is ${record.status}; only failed runs can be retried`)
    }
    const pending = this.pending.get(record.runId)
    if (!pending) {
      throw new Error(`run ${record.runId} is no longer retained; cannot retry`)
    }
    return this.executeAttempt(pending.definition, pending.context, pending.trigger, record.attempt + 1)
  }

  private async executeAttempt(
    definition: WorkflowDefinition,
    context: AgentContext,
    trigger: AutomationTrigger,
    attempt: number,
  ): Promise<WorkflowRunRecord> {
    const runId = this.newId()
    this.pending.set(runId, { definition, context, trigger })
    const startedAt = this.now().toISOString()
    const traces: WorkflowStepTrace[] = []
    let failure: string | undefined
    let lastData: unknown

    for (const step of definition.steps) {
      if (failure !== undefined) {
        traces.push({
          stepId: step.id,
          agentId: step.agentId,
          status: 'skipped',
          startedAt: this.now().toISOString(),
          finishedAt: this.now().toISOString(),
        })
        continue
      }
      const stepStartedAt = this.now().toISOString()
      try {
        const record = await this.hermes.run(step.agentId, context)
        if (record.status === 'succeeded') {
          lastData = record.result?.data
          traces.push({
            stepId: step.id,
            agentId: step.agentId,
            status: 'succeeded',
            startedAt: stepStartedAt,
            finishedAt: this.now().toISOString(),
          })
        } else {
          failure = record.error ?? `step ${step.id} (${step.agentId}) failed`
          traces.push({
            stepId: step.id,
            agentId: step.agentId,
            status: 'failed',
            startedAt: stepStartedAt,
            finishedAt: this.now().toISOString(),
            error: failure,
          })
        }
      } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
        traces.push({
          stepId: step.id,
          agentId: step.agentId,
          status: 'failed',
          startedAt: stepStartedAt,
          finishedAt: this.now().toISOString(),
          error: failure,
        })
      }
    }

    return {
      runId,
      workflowId: definition.id,
      workspaceId: context.workspaceId,
      trigger,
      attempt,
      status: failure === undefined ? 'succeeded' : 'failed',
      startedAt,
      finishedAt: this.now().toISOString(),
      steps: traces,
      result:
        failure === undefined
          ? { status: 'ok', data: lastData }
          : { status: 'error', error: failure },
    }
  }
}
