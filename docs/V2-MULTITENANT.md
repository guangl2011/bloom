# V2.0 Multi-Tenant Design + Mastra Upgrade (D6)

Status: **designed, not built.** v2.0 ships only after the three v1.0 pilots run
clean (spec locked decision 1; trigger reviewed at 5–10 customers). This note
covers what changes from the v1.0 single-tenant codebase, what needs zero
change, and the concrete mechanisms for each change. Spec semantics are cited,
not restated — see `docs/spec/SPEC.md` and `docs/spec/CHANGELOG.md` (v3.1).

## 1. Scope and principles

v2.0 turns Bloom from one-deployment-per-customer (`bloom-<customer>-prod`, via
`projectIdFor` in `adapters/adapter-deploy/src/index.ts`) into one shared
deployment serving many workspaces, with subscription billing. Three principles
carry over from v1.0 unchanged:

1. **Approval gates are hard invariants** — the `GATE_ACTIONS` vocabulary in
   `packages/interfaces/src/ids.ts` is enforced in code and CI-tested, never
   config-off. Multi-tenancy adds authorization *around* the gate; it never
   weakens it.
2. **`workspace_id` on every table and every context** — already true from day
   one: `REQUIRED_TABLE_COLUMNS` in `packages/db/src/columns.ts` (enforced by
   `packages/db/src/schema-invariants.test.ts`), `AgentContext.workspaceId` in
   `packages/interfaces/src/agent.ts`, `ToolContext.workspaceId` in
   `packages/interfaces/src/tool.ts`. v2.0 converts this day-one convention
   into enforcement (§4).
3. **Business logic in the service layer, runtimes behind interfaces** —
   agents depend on `AgentInterface`/`WorkflowInterface`/`ToolInterface`/
   `ApprovalInterface` (`packages/interfaces/src/`), never on Hermes. That is
   exactly what makes the Mastra swap a runtime change (§8).

## 2. Zero-change vs. changes (evidence-backed)

### Needs zero change

Each claim below is backed by the actual dependency boundary in the code: none
of these modules imports a runtime framework, a database client, or a cloud SDK
— only `@bloom/interfaces` types and each other's ports.

| v1.0 code | Why it survives v2.0 untouched | Evidence (read at PR head) |
|---|---|---|
| The six agents (`services/agents/src/agents/revenue-intelligence.ts`, `icp.ts`, `lead.ts`, `outreach.ts`, `ad.ts`, `conversion.ts`) | Agents receive `AgentContext` (workspaceId, input, approvals, config, runId) and return `AgentResult` — the full contract in `packages/interfaces/src/agent.ts`. Behavior comes from `WorkflowConfig` (`packages/interfaces/src/config.ts`), not from tenancy or billing. Example: `createOutreachAgent` in `services/agents/src/agents/outreach.ts` touches only its skill, `EmailTools`, and `context.approvals` — nothing tenant-aware to add. | imports of every file in `services/agents/src/agents/` are `@bloom/interfaces` + local tool shapes only |
| Roster activation (`services/agents/src/roster.ts`) | `activateAgents` selects the roster from `config.package` and `config.ads` presence — package-driven activation is orthogonal to which workspace or deployment runs it. | `roster.ts` reads only `WorkflowConfig` + toolset |
| Workflow execution semantics (`services/agents/src/runtime/workflow-runner.ts`) | `SequentialWorkflowRunner` implements `WorkflowInterface` (`packages/interfaces/src/workflow.ts`) — recordable, retryable, traceable — and imports only interface types + `HermesAgentRuntime`. Swapping either the runtime beneath it or the tenancy above it doesn't touch its step semantics. The runner's in-memory retry retention is explicitly v1-scoped in its own doc comment; durable `WorkflowRunRecord` persistence is data-layer work (§3), landing in `services/workflow`, not in the runner. | `workflow-runner.ts` imports: `@bloom/interfaces` types, `./hermes` |
| Scan-engine adapter + failover (`adapters/adapter-scan-engine/src/index.ts`, `services/agents/src/runtime/scan.ts`) | Engine selection is config (`config.purchaseSignals.engine`), composed via `composeScanEngine` — flipping engines is config, per the contract in `packages/interfaces/src/scan-engine.ts`. Tenancy doesn't enter the scan path. | `scan.ts` composes `withFallback(primary, fallback)` purely from config + registry |
| Tool layer (`packages/interfaces/src/tool.ts` `defineTool`, `services/agents/src/tools/shapes.ts`, `services/agents/src/agents/shared.ts`) | Every tool already takes `ToolContext { workspaceId, runId }` and every agent builds it via `toolContext(context)` — the workspace travels with every tool call today; v2.0 enforcement (§4) rides the same field. | `shared.ts::toolContext` maps `AgentContext` → `ToolContext` |
| Approval invariants (`packages/interfaces/src/approval.ts`, `packages/interfaces/src/ids.ts`, gate flow in `services/agents/src/agents/outreach.ts`) | `ApprovalInterface.request()` already requires a recorded `decisionId` before a downstream tool executes. v2.0 adds *who may approve* (RBAC, §5) inside the approval service — the interface and the gate vocabulary don't move. | `outreach.ts` sends only with `decision.decisionId` + `decision.approver` |
| Versioned skills (`packages/interfaces/src/skill.ts`, `services/agents/src/skills/loader.ts`, `skills/`) | Skills are versioned prompt + typed schemas, validated at load (`loadSkillFromDir` throws on malformed assets). Mastra consumes them as agent instructions (§8); multi-tenancy doesn't touch them. | `loader.ts` validation is tenancy-agnostic |
| Intake compiler (`services/config/src/compiler.ts`, `fieldmap.ts`, `versioning.ts`) | Compiles intake.json → versioned workflow YAML per customer. In v2.0 shared topology it compiles per *workspace* instead of per *deployment* — same inputs, same outputs, same field-map traceability. | compiler is a pure pipeline over intake JSON; no deployment concept in its types |
| Internal credit accounting (`services/credits/src/credits.ts`, `ledger.ts`) | Stays as the operator's internal cost model in v2.0 (§6) — the subscription layer is added *next to* it, keyed on the same `workspaceId`. | `CreditLedger` interface is workspace-keyed, billing-free |
| Deploy adapter contract (`adapters/adapter-deploy/src/index.ts`) | v2.0 adds a shared-topology mode to the same `DeployAdapter` interface (§7). The cloud-SDK import boundary (`eslint.config.mjs` `no-restricted-imports`, ignoring only `adapters/adapter-deploy/**`) stays as-is. | interface already abstracts provider + service plan |

### What changes

| Area | v1.0 today | v2.0 change | Sections |
|---|---|---|---|
| Data layer | `workspace_id` present everywhere (convention + schema test) | Query-layer enforcement + Postgres RLS as defense in depth; RBAC and billing tables | §4, §5, §6 |
| Billing | Internal credits only (`services/credits`, migrations `packages/db/migrations/0002_credit_ledger.sql`) | Stripe/Paddle subscriptions govern activation; credits remain internal cost accounting | §6 |
| Deployment | One stack per customer (`adapters/adapter-deploy/src/gcp.ts` `V1_SERVICES`, `infra/terraform/`) | One shared stack; dedicated per-customer deploy kept as an adapter mode for isolation-contract customers | §7 |
| Agent runtime | Hermes (`services/agents/src/runtime/hermes.ts`) | Mastra swaps in behind `AgentInterface` | §8 |
| Web/auth | Ops dashboard without real auth | Per-workspace auth + RBAC in `apps/web` | §5 |
| Automation | Obvious scheduled tasks per deployment | Obvious scheduled tasks per workspace (same `AutomationTrigger` rrule contract, `packages/interfaces/src/automation.ts`) | §7 |

## 3. Migration steps: v1.0 single-tenant → v2.0 shared multi-tenant

Ordered so that every phase is independently verifiable and the pilots are
never disturbed. Phases 1–3 run on new code deployed *alongside* the v1.0
stacks; cutover is per-customer, one at a time.

1. **Phase 0 — preconditions.** Three pilots run clean; the 5–10-customer
   trigger is hit; spec revised with a versioned changelog entry (per
   `docs/spec/CHANGELOG.md` policy). No code yet.
2. **Phase 1 — data-layer enforcement.** Build the repository/query layer
   (§4) and enable RLS; add the cross-workspace CI test (spec Layer 1's
   "cross-workspace read attempt fails" becomes a real test against the shared
   schema). Ship as new migrations under `packages/db/migrations/` — the
   existing `0001_extensions.sql`–`0003_knowledge_chunks.sql` tables need no
   rewrite: they already carry `workspace_id` and the audit/soft-delete
   columns (`packages/db/src/columns.ts`).
3. **Phase 2 — RBAC + auth.** Add identity to `apps/web`, add the
   `workspace_members` / roles tables, wire role checks into the approval
   service (§5). Gate: the nightly approval-gate probe (spec Layer 2) passes
   with authorization active.
4. **Phase 3 — billing.** Stand up the subscription service, Stripe/Paddle
   webhooks, and activation gating (§6). Internal credits continue recording;
   a reconciliation invariant test (existing `reconcileWorkspace` math in
   `services/credits/src/credits.ts`) must stay green untouched.
5. **Phase 4 — Mastra.** Build the Mastra runtime behind `AgentInterface`,
   prove parity with the existing contract tests, cut over (§8). Agents,
   adapters, workflow engine: zero edits.
6. **Phase 5 — cutover + decommission.** Migrate pilot customers one at a
   time: export their per-deployment data (all keyed by `workspace_id`
   already) into the shared deployment, flip their Obvious scheduled tasks to
   the shared deployment's webhooks, tear down their
   `bloom-<customer>-prod` stacks. The dedicated-deploy path stays alive for
   customers whose contract requires physical isolation (§7).

Rollback per phase: Phases 1–4 are additive (new tables, new service, new
runtime module); the v1.0 stacks keep running until Phase 5 decommissions
them, so any phase can be abandoned without touching pilots.

## 4. workspace_id enforcement at the query layer

**Today (v1.0):** every table carries `workspace_id` as a column invariant
(`packages/db/src/columns.ts::REQUIRED_TABLE_COLUMNS`, tested by
`packages/db/src/schema-invariants.test.ts`), and every in-memory context
carries it (`AgentContext`, `ToolContext`). But because each deployment is
single-tenant, *nothing forces a query to filter by it* — isolation is
physical. That is the one v1.0 guarantee that silently expires in a shared
deployment, so v2.0 makes it mechanical, at two layers:

1. **Application layer — one choke point.** `packages/db` gains a
   workspace-scoped repository: every statement is built through
   `withWorkspace(workspaceId, (scope) => …)`, which (a) appends
   `WHERE workspace_id = $1` to every SELECT/UPDATE/DELETE and sets it on
   every INSERT, and (b) refuses to execute any raw-SQL escape hatch that
   didn't pass through the scope. There is no second code path — services
   that today would compose queries directly (e.g. `services/workflow`,
   `services/approval` when their persistence lands) go through this layer
   only. This mirrors the discipline already present in
   `services/credits/src/credits.ts::reconcileWorkspace`, whose doc comment
   promises "cross-workspace rows never enter the snapshot."
2. **Database layer — Postgres RLS, defense in depth.** For every table:
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`,
   and one policy per table:
   `USING (workspace_id = current_setting('app.workspace_id')::text)`. The
   application sets `SET app.workspace_id = '<id>'` (per transaction, from the
   `AgentContext`/`ToolContext` value — the same string already threaded
   through `toolContext()` in `services/agents/src/agents/shared.ts`). The
   app connects as a non-superuser role (RLS does not bind table owners
   unless forced — hence `FORCE`). Even a bug in the repository layer then
   returns the wrong tenant's rows to no one.

**Verification:** a CI test (new, `tests/db/cross-workspace.test.ts`) that (a)
reads row A as workspace 1 and asserts workspace 2 cannot see it, with and
without the repository scope; (b) asserts `set app.workspace_id` + RLS blocks a
direct SQL read outside the scope; (c) asserts every table has an RLS policy
extending `packages/db/src/schema-invariants.test.ts`'s column check. This
replaces the v1.0 "trivially isolated" claim with an enforced one.

## 5. Per-workspace RBAC activation

**Today (v1.0):** approvers are named strings in
`WorkflowConfig.approval.approvers` (`packages/interfaces/src/config.ts`),
routed by per-deployment config; `apps/web` has no real auth — physical
isolation substitutes for authorization.

**v2.0 mechanisms:**

- **Tables** (new migration): `workspaces` (one row per customer tenant),
  `users`, `workspace_members (workspace_id, user_id, role)` with roles
  `owner | admin | approver | viewer` — all carrying the day-one audit/
  soft-delete columns from `packages/db/src/columns.ts`.
- **Role → capability mapping:** `viewer` reads dashboards/reports;
  `approver` may decide gate actions (`GATE_ACTIONS` from
  `packages/interfaces/src/ids.ts`); `admin` manages config (the
  config-review approval from the spec's onboarding flow); `owner` manages
  membership and billing. The mapping lives in the approval service
  (`services/approval`), not in agents: `ApprovalInterface.request()` is
  unchanged, but the service now (a) resolves the requesting workspace from
  the authenticated principal, (b) checks the approver's role for that
  specific `workspace_id`, and (c) only then records the
  `ApprovalDecision` (`packages/interfaces/src/approval.ts`) whose
  `decisionId` downstream tools require. An unauthorized approver gets a
  rejected decision — recorded, audit-logged, never silently dropped.
- **Dashboard:** `apps/web` scopes every page by the authenticated user's
  `workspace_members` rows; cross-workspace navigation is a 403, backed by
  the §4 RLS guarantee underneath.
- **What doesn't change:** agents never learn about roles — they see
  `context.approvals` exactly as in
  `services/agents/src/agents/outreach.ts`. The gate's hard-invariant status
  (spec locked decision 10) is preserved; RBAC narrows *who* can approve, it
  cannot turn the gate off.

**Verification:** the nightly approval-gate probe (spec Layer 2) gains an
authorization case — a simulated send approved by a `viewer` is rejected and
logged; CI adds a unit test for the role mapping in `services/approval`.

## 6. Billing swap: Stripe/Paddle subscriptions, credits stay internal

**Today (v1.0):** `services/credits` is internal-only cost accounting — price
catalog, `usage_records` + `credit_transactions` ledger
(`packages/db/migrations/0002_credit_ledger.sql`), reconciliation via
`reconcileWorkspace`. Customers never see it (per the module's own doc
comment). There is no customer-facing billing; service contracts are manual.

**v2.0 mechanisms:**

- **New subscription service** (`services/billing`, built like the existing
  services on `packages/service-kit`): tables `plans`,
  `subscriptions (workspace_id, plan, status, current_period_end)`,
  `invoices`. Plans are priced per service package — the two tiers the
  product already speaks, `SERVICE_PACKAGES` in
  `packages/interfaces/src/config.ts` (`intelligence_starter`,
  `lead_generation_pro`) — plus metered overage dimensions if priced.
- **Provider choice:** Stripe for card-first customers; Paddle where
  merchant-of-record tax handling is wanted. Both behind one
  `BillingProviderInterface` in `services/billing` — same adapter pattern as
  `adapters/adapter-deploy/src/index.ts` and
  `packages/interfaces/src/scan-engine.ts`; adding a provider is a new
  implementation, not a service change. Webhook ingestion (subscription
  created/renewed/failed/canceled) is idempotent and audit-logged.
- **Activation gating replaces per-deployment entitlement.** Today a
  customer "gets" agents by owning a deployment compiled from their package
  (`services/agents/src/roster.ts::activateAgents`). In v2.0 the same
  config-driven activation runs, but a workspace's workflow can only be
  activated/redeployed when `subscriptions.status` is active — checked in
  `services/workflow` at config-activation time, and enforced again at
  run-trigger time in the Obvious webhook entry point. Package downgrades
  take effect at period end: `roster.ts` already derives the roster from
  config, so a config recompile (the same `services/config` compiler) is the
  entire enforcement mechanism.
- **Credits stay internal — unchanged.** `usage_records` /
  `credit_transactions` / `credit_balances` keep recording every priced
  tool/model call keyed by `workspaceId` (`services/credits/src/ledger.ts::CreditLedger`).
  Their role shifts from "the only money in the system" to the operator's
  unit-cost + margin model: subscription revenue (billing tables) vs. credit
  consumption (ledger), joined on `workspace_id`. The reconciliation
  invariant ("sum of usage-record costs equals the sum of `usage`
  transaction deltas") is untouched, so the weekly credit-reconciliation
  test (spec Layer 2) keeps running as-is.
- **What does not change:** the credit ledger never talks to Stripe/Paddle;
  agents and the approval gate never learn about subscriptions. The only new
  coupling is workflow activation reading subscription state.

**Verification:** CI covers webhook idempotency (duplicate delivery → one
state change), activation refusal for `status != 'active'`, and — the
invariant that matters — the existing `services/credits` test suite passes
with zero modifications.

## 7. Shared-deployment topology

**Today (v1.0):** one stack per customer. `adapters/adapter-deploy/src/gcp.ts`
plans four Cloud Run services (`workflow` 4101, `approval` 4102, `agents`
4103, `web` 3000) + Cloud SQL Postgres/pgvector + Secret Manager, driven by
Terraform in `infra/terraform/`, into a per-customer project named by
`projectIdFor` (`bloom-<customer>-prod`). Isolation is physical; the price is
three stacks to operate and every improvement shipped three times — the cost
the spec accepts for pilots and reviews at the v2.0 trigger.

**v2.0 — one shared stack:**

- **Topology:** a single project runs the same four services (same
  `ServicePlan` shapes) for all workspaces; one shared Postgres with the §4
  RLS + repository enforcement; Secret Manager holds shared provider keys,
  while per-workspace secrets (customer SMTP creds, CRM tokens) move from
  deployment env vars to encrypted-at-rest rows keyed by `workspace_id`,
  decrypted per use inside the relevant adapter.
- **Deploy adapter extension, not rewrite.** `DeployAdapter` in
  `adapters/adapter-deploy/src/index.ts` gains a topology discriminator
  (`dedicated` = today's behavior, byte-for-byte; `shared` = plan/apply one
  stack + workspace provisioning calls). The credential-gated `apply` and
  the human-approval gate (`BLOOM_DEPLOY_APPROVED`) carry over unchanged;
  the cloud-SDK lint boundary in `eslint.config.mjs` is untouched, and the
  existing import-boundary test (`tests/deploy/import-boundary.test.ts`)
  still proves no GCP/Azure SDK leaks outside the adapter.
- **Both topologies coexist.** The spec's 保密承诺 argument for physical
  isolation doesn't disappear with scale — a customer whose contract demands
  it keeps the dedicated path, because deployment lives behind the adapter
  and nothing in services/agents knows which topology it runs in.
  `AutomationTrigger` (`packages/interfaces/src/automation.ts`) is topology
  blind either way: in shared mode, Obvious scheduled tasks are created per
  workspace (rrule from each `WorkflowConfig`), all landing on the same
  deployment's webhook entry with `workspaceId` in the payload — the same
  `AgentContext` field the runtime already threads everywhere.
- **Blast radius:** shared failure domain replaces "a failure in one pilot
  cannot affect another." Mitigations: per-workspace rate limits and scan
  quotas already expressed in config (`maxSignalsPerPeriod`, `dailySendCap`
  in `packages/interfaces/src/config.ts`) are enforced per workspace at the
  workflow entry point; the Layer-2 recurring tests run against the shared
  reference workspace instead of the reference deployment.

**Verification:** deploy-smoke (spec Layer 2) runs against the shared stack;
a design test asserts `dedicated` planning output is unchanged from v1.0's
(the `plan()` snapshot for a reference customer matches the v1.0 fixture in
`tests/fixtures/deploy/`).

## 8. Mastra upgrade behind AgentInterface

**Today (v1.0):** `HermesAgentRuntime` (`services/agents/src/runtime/hermes.ts`)
hosts the six agents: registration (`register`/`registerAll`), `run` returning
an `AgentRunRecord` (workspace-keyed, attempt-counted, error-surfaced), and
`retry` replaying the retained context. Its own doc comment states the swap
plan: "Mastra swaps in behind AgentInterface in v2.0 — Hermes is the thing
being swapped, so it never leaks into agent code." Verified at this PR head:
no file under `services/agents/src/agents/` imports Hermes; the only Hermes
consumer is `services/agents/src/runtime/workflow-runner.ts`, which takes it
as a constructor argument while depending on `WorkflowInterface` types.

**Upgrade mechanism:**

1. **New module, same contract.** Add
   `services/agents/src/runtime/mastra.ts` implementing the registration/
   run/retry surface that `HermesAgentRuntime` exposes today, returning the
   same `AgentRunRecord` shape and honoring the same invariants: failures
   become records (never swallowed — hermes.ts already normalizes thrown and
   returned errors identically), retries execute at `attempt + 1` with the
   original context replayed unchanged, and every record carries
   `workspaceId`. Inside, Mastra agents are constructed *from* the v1.0
   agents' assets: `SkillDefinition` prompts and typed schemas
   (`packages/interfaces/src/skill.ts`, loaded by
   `services/agents/src/skills/loader.ts`) become Mastra agent instructions
   and validation; `WorkflowConfig` stays the behavior driver.
2. **Parity gate before cutover.** The existing suites
   (`services/agents/src/agents/agents.contract.test.ts`,
   `services/agents/src/runtime.workflow.test.ts`,
   `agents.parameterization.test.ts`) run against the Mastra runtime with
   **zero agent-code edits** — that is the acceptance test for the swap,
   exactly mirroring the engine-swap test pattern the scan adapter already
   uses (`services/agents/src/runtime/scan.ts`: flip config, no code
   changes). Wiring chooses the runtime via one factory (config flag, e.g.
   `runtime: 'hermes' | 'mastra'`), so a deployment can flip and roll back
   without rebuilds.
3. **Automation contract unchanged.** Obvious scheduled tasks trigger runs
   through the same `AutomationTrigger` vocabulary
   (`packages/interfaces/src/automation.ts`) — Mastra inherits schedules,
   retries, and audit from the Obvious layer rather than re-implementing
   them, so the v3.1 locked decision (cron/retries/audit live on the Obvious
   side) survives the framework change intact.
4. **Then delete Hermes.** Only after the parity gate holds in the shared
   deployment does `hermes.ts` come out — and with it the last
   framework-flavored module in the service layer.

**What does not change:** all six agents, roster activation, workflow
execution semantics, tools, approval flow, scan-engine composition, skills
assets, and the intake compiler (see §2 — every claim is a file-level
dependency fact at this PR head).

## 9. Out of scope here

Pricing levels for v2.0 (the docs' $299–$999 draft is explicitly a draft —
spec §11, open question 3), the billing provider's tax/legal setup, and the
actual customer migration schedule. This note fixes mechanisms and seams, not
prices or dates.
