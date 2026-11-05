# AGENTS.md — Bloom platform repo

## Commands

- Install: `pnpm install --frozen-lockfile` (pnpm 12.16.1 and Node >=22 — both pinned)
- Lint: `pnpm lint` · Typecheck: `pnpm typecheck` (runs `tsc --noEmit` per package)
- Unit tests: `pnpm test` (Vitest, root config)
- Full stack: `docker compose up -d --wait` → smoke: `bash tests/e2e/smoke.sh` → down: `docker compose down -v`
- Web dev: `pnpm --filter @bloom/web dev`

## Layout (PRD §9 monorepo)

- `apps/web` — Next.js ops dashboard (market map, leads, approval console)
- `services/` — Bloom service layer: `workflow` (workflow engine), `approval` (approval gate + audit), `agents` (six-agent runtime)
- `adapters/` — vendor edges behind swappable interfaces: `adapter-scan-engine` (Obvious primary, Deepline fallback)
- `packages/` — shared contracts: `interfaces` (Agent/Workflow/Tool/Approval), `service-kit` (health server)
- `skills/` — versioned per-agent prompts/skills · `infra/` — Terraform/deploy (D4) · `tests/` — e2e + fixtures

## Invariants (spec v3.1 — do not violate)

- Approval gates (email_send, crm_write, ad_budget_change, bulk_scan, large_export, high_cost_model_call, connect_customer_production) are hard-coded invariants — never config-off.
- Every table and every agent context carries `workspace_id` from day one.
- Agents depend on interfaces, never on a framework — Mastra swaps in behind AgentInterface in v2.0.
- Scan-engine selection is config (Obvious primary, Deepline fallback), never agent code.
- Business logic lives in the service layer; runtimes (Hermes/Obvious now, Mastra later) sit behind the interfaces.

## Conventions

- TypeScript strict, ESM (`"type": "module"`), source exports (`exports` maps to `src/index.ts`) — workspace packages need no build step yet.
- New workspace package? Add its `package.json` to the deps stage of the root `Dockerfile` (explicit COPY list).
- Spec: `docs/spec/SPEC.md` + `CHANGELOG.md`; spec changes are versioned, never silent.
