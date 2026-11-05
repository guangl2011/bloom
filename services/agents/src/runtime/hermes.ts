import { randomUUID } from 'node:crypto'
import type { AgentContext, AgentId, AgentInterface, AgentResult } from '@bloom/interfaces'

export interface AgentRunRecord {
  readonly runId: string
  readonly agentId: AgentId
  readonly workspaceId: string
  /** 1 on first execution; +1 on every retry. */
  readonly attempt: number
  readonly status: 'succeeded' | 'failed'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly result?: AgentResult
  readonly error?: string
}

export interface HermesOptions {
  /** Injectable clock and id factory keep records deterministic in tests. */
  readonly now?: () => Date
  readonly newId?: () => string
}

/**
 * Hermes — the v1.0 agent runtime. Hosts the six agents behind AgentInterface;
 * every run is recorded, every record carries workspace_id, and failed runs
 * are retryable. Mastra swaps in behind AgentInterface in v2.0 — Hermes is the
 * thing being swapped, so it never leaks into agent code (spec locked
 * decision 2). Schedules, retries, and audit for production recurring runs
 * live on Obvious scheduled tasks, which trigger into this runtime.
 */
export class HermesAgentRuntime {
  private readonly agents = new Map<AgentId, AgentInterface>()
  /** Original contexts by runId so failed runs can be retried (bounded by run volume; v1 is in-memory). */
  private readonly contexts = new Map<string, AgentContext>()
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(options: HermesOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomUUID())
  }

  /** Registers an agent; a duplicate id is a wiring defect and throws. */
  register(agent: AgentInterface): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`agent ${agent.id} is already registered`)
    }
    this.agents.set(agent.id, agent)
  }

  registerAll(agents: readonly AgentInterface[]): void {
    for (const agent of agents) {
      this.register(agent)
    }
  }

  get(agentId: AgentId): AgentInterface {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`agent ${agentId} is not registered`)
    }
    return agent
  }

  list(): readonly AgentInterface[] {
    return [...this.agents.values()]
  }

  /**
   * Runs an agent and returns its record. Agent failures become failed
   * records — surfaced to the caller and retryable, never swallowed.
   */
  async run(agentId: AgentId, context: AgentContext): Promise<AgentRunRecord> {
    const agent = this.get(agentId)
    const runId = this.newId()
    this.contexts.set(runId, context)
    return this.executeAttempt(agent, context, runId, 1)
  }

  /** Re-runs a failed record at attempt+1 with the original context replayed unchanged. */
  async retry(record: AgentRunRecord): Promise<AgentRunRecord> {
    if (record.status !== 'failed') {
      throw new Error(`run ${record.runId} is ${record.status}; only failed runs can be retried`)
    }
    const context = this.contexts.get(record.runId)
    if (!context) {
      throw new Error(`context for run ${record.runId} is no longer retained; cannot retry`)
    }
    const agent = this.get(record.agentId)
    return this.executeAttempt(agent, context, this.newId(), record.attempt + 1)
  }

  private async executeAttempt(
    agent: AgentInterface,
    context: AgentContext,
    runId: string,
    attempt: number,
  ): Promise<AgentRunRecord> {
    const startedAt = this.now().toISOString()
    const scoped: AgentContext = { ...context, runId }
    let result: AgentResult
    let error: string | undefined
    try {
      result = await agent.run(scoped)
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown)
      result = { status: 'error', error: message }
    }
    if (result.status !== 'ok') {
      // Returned errors and thrown errors land on the record identically —
      // a trace that says only "failed" is an invisible bug.
      error = result.error ?? `agent ${agent.id} returned an unspecified error`
    }
    return {
      runId,
      agentId: agent.id,
      workspaceId: context.workspaceId,
      attempt,
      status: result.status === 'ok' ? 'succeeded' : 'failed',
      startedAt,
      finishedAt: this.now().toISOString(),
      result,
      ...(error !== undefined ? { error } : {}),
    }
  }
}
