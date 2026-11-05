# Bloom

Bloom is Spotlize's revenue-intelligence and overseas-growth agent platform for industrial
manufacturers and B2B exporters — market and competitor intelligence, purchase-signal
monitoring, lead discovery and scoring, and approval-gated outreach.

- **v1.0** ships service-first: custom single-tenant deployments per pilot customer, driven by
  per-customer workflow configs compiled from their intake workbook.
- **v2.0** upgrades the agent runtime (Mastra behind AgentInterface) and repackages the engine
  as a multi-tenant subscription SaaS.

Platform spec v3.1: `docs/spec/` · Charter: `docs/CHARTER.md` · Intake template: `templates/`
(all landing in companion PRs).

## Quickstart

```bash
pnpm install --frozen-lockfile   # pnpm 12.16.1, Node >= 22
pnpm lint && pnpm typecheck && pnpm test
docker compose up -d --wait      # web + services + Postgres/pgvector
bash tests/e2e/smoke.sh
docker compose down -v
```

Web dashboard: http://localhost:3000 · workflow :4101 · approval :4102 · agents :4103.

## Layout

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js ops dashboard (placeholder) |
| `services/` | `workflow`, `approval`, `agents` (six-agent roster behind AgentInterface) |
| `adapters/` | `adapter-scan-engine` — Obvious primary, Deepline fallback behind ScanEngineInterface |
| `packages/` | `interfaces` (Agent/Workflow/Tool/Approval), `service-kit` (health server) |
| `skills/` | Versioned per-agent prompts and skills |
| `infra/` | Terraform + deploy adapter (D4) |
| `tests/` | e2e smoke + fixtures (reference-customer fixtures land with D5) |

## CI

PR-blocking checks: `lint` (ESLint) · `typecheck` (tsc, per package) · `test` (Vitest) ·
`gitleaks` (secret scan) · `compose-smoke` (builds the stack, boots it, asserts every health
endpoint). See `.github/workflows/ci.yml`.
