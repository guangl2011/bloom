# Bloom Service-First Platform Spec

> **Version: v3.1** — see [CHANGELOG.md](./CHANGELOG.md) for revision history.
> Revisions during development are explicit new versions with changelog entries — never silent edits.
> CI note: any PR that modifies files under `docs/spec/` must include a CHANGELOG entry.

**Source of truth:** the approved blueprint "Bloom v1.0→v2.0 Service-First Platform Spec" (art_SL0wUCva), Spotlize · Bloom · Spec v3.1, per Richard Lu's v3.1 review. The four predecessor documents (PRD v1.0, Roadmap v2.2, Architecture PRD v1.0, 增值服务包) are superseded on sequencing only — their architecture constraints carry over.

---

## 1. Direction

Start with three customers on custom single-tenant Agent workflows built on the Bloom platform; productize into a multi-tenant subscription SaaS once their flows run clean. This inverts the product-first sequencing of PRD v1.0 / Roadmap v2.2: **solve three real customers' problems with custom-built Agent workflows first, and only then sell the tool.**

**Decision to approve:**

> Bloom ships as **v1.0 — a single-tenant platform deployed once per customer** (three pilot deployments on their own cloud project, GCP by default), running *customized* Agent workflows derived from their service package (Intelligence Starter or Lead Generation Pro), with the backend automation executed by **Obvious + Hermes**. After the three customer flows run clean, **v2.0 upgrades the agent framework to Mastra and re-packages the engine as a multi-tenant subscription SaaS** — deploy once, customers subscribe. No pricing tier is exposed to customers in v1.0; billing exists only as internal credit accounting.

Two things ride along because the brief names them explicitly: an **updated initial document** (D1, `docs/CHARTER.md`) and a **customer intake template** (功能需求和业务流程表, D2) — the intake data is the customization contract that drives each v1.0 deployment's workflow config.

**Cloud provider:** GCP for v1.0 behind a deploy adapter; Azure is a config-level port later. Reversal condition: a target customer requires Azure-only hosting — the adapter keeps that a deploy-layer change, not a rewrite.

**Credential gate:** cloud credentials do not exist in the workspace yet. The build delivers deploy scripts, Terraform, and CI-verified local equivalents; the first real cloud deploy executes when GCP credentials are provided via the secrets flow. The three pilot customers do not exist yet — a synthetic reference customer (D5) validates onboarding.

---

## 2. Deliverables

D1–D2 are documents; D3–D7 are the platform, in build order.

| # | Deliverable | Summary |
|---|---|---|
| D1 | Initial document v3.0 | `docs/CHARTER.md` + Obvious artifact: five-layer platform, six agents unchanged; commercial sequence rewritten service-first; package→module mapping; v1.0/v2.0 boundary incl. Mastra plan |
| D2 | Customer intake template | 8-sheet workbook (公司概况 / 产品线与出口 / 目标市场与区域 / 竞争对手 / 关键词与信号 / ICP与线索标准 / 交付与审批 / 字段映射 internal); in-repo `templates/customer-intake.xlsx` |
| D3 | v1.0 platform | Monorepo per PRD §9; six agents behind AgentInterface on Hermes + Obvious runtime; Agent/Workflow/Tool/Approval interfaces + swappable ScanEngineInterface (Obvious primary, Deepline fallback); intake-driven versioned YAML workflow config; internal lead scoring; LLM/email/CRM adapters; Next.js ops dashboard; internal credit accounting |
| D4 | Cloud deployment | Terraform + Docker Compose per-customer project `bloom-<customer>-prod` (Cloud Run, Supabase/Cloud SQL Postgres + pgvector, Secret Manager, Cloud Logging); deploy adapter isolates provider |
| D5 | Reference customer | Synthetic Lead Generation Pro customer: intake → config → full pipeline run with no real sends, committed under `deployments/reference/` |
| D6 | v2.0 design note | `docs/V2-MULTITENANT.md`: workspace_id enforcement, RBAC, Stripe/Paddle billing, shared deploy, Mastra behind AgentInterface — designed, not built |
| D7 | Spec version management | This directory: `docs/spec/SPEC.md` + `docs/spec/CHANGELOG.md`; versioned revisions, CI-enforced changelog discipline |

---

## 3. Architecture (v1.0 stack, simplified per v3.1 review)

One engine, two deployment shapes, deliberately simple v1.0 stack:

- **Runtime:** Hermes with Obvious as the automation runtime. Obvious scheduled tasks carry rrule schedules and webhook triggers — cron, retries, and audit live there. **Mastra is a v2.0 upgrade** behind AgentInterface; the interface is the compatibility plan.
- **Scan engines:** swappable ScanEngineInterface — **Obvious primary, Deepline fallback** (deepline.com/docs). **No Visible API; no Apify/Tinyfish crawlers** — precision too low for purchase-signal work per the v3.1 review.
- **Deployment shape:** single-tenant per customer. Isolation trivially absolute (own cloud project), failures cannot cascade, customization is per-deployment config. Price: three stacks to operate; mitigated by keeping per-customer state in one `intake.json`-driven config. When operating cost dominates (5–10 customers), that is the trigger to ship v2.0.
- **Business logic** lives in the Bloom service layer, never inside a runtime framework.

### Reference workflow config (v3.1)

```yaml
customer: reference-medspa
package: lead_generation_pro   # intelligence_starter | lead_generation_pro
workflow:
  market_intel:
    schedule: "0 6 1 * *"      # monthly brief — module A cadence
    keywords: ${intake.keywords.monitor}
    regions: ${intake.markets.regions}
  purchase_signals:
    schedule: "0 6 * * 1"      # weekly push
    engine:
      primary: obvious         # Obvious platform research run
      fallback: deepline       # swap point is config, not code
    max_signals_per_period: 50
  lead_scoring:
    model: internal_v1         # in-repo scoring model, tuned per customer
    tuning: ${intake.icp.criteria}
    tiers: { A: ">=0.8", B: "0.5-0.8", C: "0.3-0.5" }
    monthly_quota: 50
  outreach:
    channels: [email]          # email automation first; CRM via crm-write adapter
    mode: approval_gated_send  # sends only after a human approval decision
  ads:
    platforms: [google, linkedin]  # read-only recommendations in v1.0
  approval:
    gate_actions: [email_send, crm_write, ad_budget_change, bulk_scan, large_export, high_cost_model_call]
    approvers: ${intake.approvals.contacts}
version: 3                      # every config change versioned, audit-logged
```

---

## 4. Agent roster (unchanged from Architecture PRD)

| Agent | v1.0 mission | Tools / adapters | Hard boundary |
|---|---|---|---|
| Revenue Intelligence | Market map, competitor scan, keyword/intent clusters, opportunity scoring; monthly brief (A), quarterly trends (C), weekly purchase-signal scan | Scan-engine adapter (Obvious primary, Deepline fallback); llm-router | No outreach, no CRM writes, no execution |
| ICP | Turns intake ICP sheet into internal scoring model tuning | Internal scoring model (`internal_v1`) | No outreach or ad execution |
| Lead | Discovers and scores companies/contacts to quota (50/mo Lead Pro), enriches (Apollo), maintains lead pool | Consumes ICP-tuned scores; feeds Outreach drafts | No auto-contact, no direct CRM updates |
| Outreach | Drafts email sequences, queues for approval, executes approved sends; cadences on Obvious tasks | Email adapter; approval-queued crm-write | Nothing sends without a human approval decision |
| Ad | Read-only ad account status + campaign recommendations | Read-only adapters | Never spends or modifies campaigns in v1.0 |
| Conversion | Tracks opportunities via approval-queued CRM writes, attributes closed revenue to originating signal | Approval gate only | No CRM record modified without sign-off |

**Package → module mapping:** Intelligence Starter activates Revenue Intelligence + ICP. Lead Generation Pro adds Lead, Outreach, Conversion (ads recommendations optional per intake). A customer never gets an agent their package didn't buy — the workflow config omits those blocks and the dashboard hides them.

> **Approval gates (hard invariant):** email send · CRM write · ad budget change · bulk scan · large export · high-cost model call · connect to customer production systems — enforced in the ApprovalInterface for every agent, every version, v1.0 and v2.0 alike. Never configurable off.

---

## 5. Intake workbook — the customization contract

Eight sheets; every field has instructions, examples, required flag. English and Chinese headers side by side. Customers are 出海 industrial/B2B exporters.

| Sheet | Customer provides | Feeds |
|---|---|---|
| 1 · 公司概况 Company Profile | Legal name, domain, size, export history, current markets, sales team | Market map seed, knowledge base |
| 2 · 产品线与出口 Product Lines | Categories, HS codes, certifications, price band, MOQ posture | Product-match scoring, lead filtering |
| 3 · 目标市场与区域 Markets & Regions | Ranked regions, service package, growth goals | Scan scope, regional analysis (G) |
| 4 · 竞争对手 Competitors | 3–5 competitors + how found; blanks for AI suggestion | Competitor tracking (F) |
| 5 · 关键词与信号 Keywords & Signals | Keywords (Starter ≤10, Pro ≤30), channels, noise examples | Purchase-signal monitoring (B) |
| 6 · ICP 与线索标准 ICP & Lead Criteria | ICP definition, A/B/C criteria in customer's words, disqualifiers, target roles | ICP scoring model, lead quota |
| 7 · 交付与审批 Delivery & Approvals | Report languages, delivery dates, approval contacts/channels, send cap, CRM system | Scheduling, approval routing, CRM config |
| 8 · 字段映射 Field Map (internal) | Completed by us: every intake field → config key → agent | Config compilation, completeness check |

**Machine-checkable completeness:** the compiler rejects an `intake.json` missing required fields (package tier, ≥1 region, ≥1 keyword, ≥1 approval contact) and names the exact sheet/field — also a test.

---

## 6. Two flows

1. **Onboarding:** intake workbook → compile (gate: incomplete intake cannot reach config review) → human review of generated workflow config (itself approval-gated) → live deployment.
2. **Weekly production loop:** signal → agent work → delivery; the only path to an external action is a human approval decision, every approval audit-logged with agent, prompt version, and cost. Dashed loop from delivery back into scanning = contracted reporting cadence (module A brief by the 1st, competitive report by the 5th). Schedules live in the workflow config — contract terms translate directly into cron entries.

---

## 7. Testing — two layers

### Layer 1 — CI (every PR, blocking)

- **Unit:** intake compiler (valid/invalid fixtures; missing required field names the exact sheet/field), internal scoring model + per-customer tuning, credit accounting math, config versioning
- **Integration:** agent runs on Hermes + Obvious runtime against adapter mocks; approval gate blocks every gate action without a decision; outreach rejects sends without a recorded human decision; scan-engine fallback fires when primary fails
- **E2E:** reference-customer pipeline in Docker Compose — market map → signals → leads → email drafts; assertions on outputs and logs; zero external sends
- **Security:** cross-workspace read attempt fails; secrets never in logs; every high-risk action in the audit trail

### Layer 2 — recurring functional tests (scheduled on Obvious, against the reference deployment)

| Scheduled test | Cadence | Asserts | Failure means |
|---|---|---|---|
| Market-map workflow e2e | Nightly | Monthly brief workflow completes; stable JSON schema; report rendered | Core service promise broken — CSM alerted before customer notices |
| Approval-gate probe | Nightly | Simulated send/CRM-write without approval rejected and logged | Safety invariant violated — P0 incident |
| Lead-pool quality check | Weekly | Pool ≥ quota, contact fields present, A-tier accuracy ≥ 85%; runs once per scan engine (Obvious, Deepline) | Service commitment (≥50 leads/mo, ≥85%) at risk — or fallback silently rotted |
| Credit reconciliation | Weekly | Usage credits = balance delta; no unpriced tool calls | Cost tracking drift |
| Deploy smoke (staging) | Weekly | Terraform plan clean; compose up; health checks; dashboard loads | Deploy path broken — blocks next onboarding |

Dogfooding: PRs changing rendered UI get agent-browser screenshots; backend-only changes state why visual evidence does not apply.

---

## 8. Acceptance criteria

| Deliverable | Verifiable acceptance criteria |
|---|---|
| D1 | `docs/CHARTER.md` in-repo + Obvious artifact, contents identical; package→module mapping table + explicit v1.0/v2.0 boundary incl. Mastra plan; no residual product-first pricing as customer-facing; states supersession of PRD v1.0/Roadmap v2.2 |
| D2 | Obvious workbook, 8 sheets, instructions + example + required flag per field; in-repo xlsx matches (round-trip test workbook → xlsx → compiler fixture); field map covers 100% of fields, proven by compiler unit test |
| D3 | Monorepo matches PRD §9; `docker compose up` boots full stack with health checks; unit + integration suites green (6 agents behind AgentInterface, 4 interfaces, intake compiler, scoring model, credit accounting); approval-gate P0 tests enforced in CI; every table carries workspace_id + audit + soft delete (schema test); config-driven parameterization test; engine-swap test (flip `engine.primary` obvious→deepline with zero agent-code edits; fallback fires on failure); E2E reference run with zero external sends |
| D4 | `terraform plan` against test fixture passes in CI; compose local equivalent boots; deploy adapter interface defined (lint: no GCP SDK imports outside adapter); real first deploy credential-gated, tracked — not silently skipped |
| D5 | Synthetic intake → `intake.json` → workflow config committed under `deployments/reference/`; full pipeline run: market map + ≥50-scored-lead fixture + email drafts queued; approving one draft produces exactly one queued (not sent) email adapter call, audit-logged |
| D6 | `docs/V2-MULTITENANT.md` covers migration, RBAC, billing swap, shared topology, Mastra upgrade plan; names zero-change vs changed areas |
| D7 | Spec in-repo at `docs/spec/SPEC.md` + `docs/spec/CHANGELOG.md`; v3.1 changes vs v3.0 listed (Visible API out, Mastra deferred, scan-engine adapter, internal scoring, email-first outreach, Google+LinkedIn ads); revisions are explicit versions with changelog entries; each PR changing spec semantics updates the changelog (CI lint check) |

---

## 9. Locked decisions (v3.1)

1. **Service-first GTM.** v1.0 = three custom single-tenant deployments; v2.0 = multi-tenant subscription SaaS, designed now, built after pilots run clean.
2. **Runtime: Hermes + Obvious for v1.0.** Obvious scheduled tasks (rrule) and webhook triggers drive recurring workflows; Mastra is a v2.0 upgrade behind AgentInterface.
3. **Scan engines: Obvious primary, Deepline fallback**, behind a swappable ScanEngineInterface. No Visible API; no Apify/Tinyfish crawlers.
4. **Lead scoring: internal model** (`internal_v1`), tuned per customer from intake ICP criteria.
5. **Outreach: email automation first** (draft → approval → send) with CRM connect via approval-queued crm-write adapter.
6. **Ads: Google Ads + LinkedIn Ads only**, read-only recommendations in v1.0.
7. **GCP for v1.0**, behind a deploy adapter keeping an Azure port config-level.
8. **Repo: `guangl2011/bloom`, monorepo per PRD §9**, scaffolded from scratch.
9. **Agent roster and boundaries unchanged**; package selection (not product tier) activates agents per deployment.
10. **Approval gates are hard invariants** — enforced in code and CI-tested, never config-off.
11. **workspace_id on every table from day one** so v2.0 is a data-layer migration.
12. **Intake workbook (D2) is the customization contract**; workflow configs compile from it and are versioned.
13. **Spec version management:** versioned in-repo (`docs/spec/` + changelog); revisions during development are explicit new versions — never silent edits.

---

## 10. Risks

- **External-credential gaps** (Deepline, EasyRouter, Apollo, Google/LinkedIn Ads read-only): build against mocks + sandbox keys; real keys requested via the secrets flow at Implement time.
- **First real cloud deploy** is credential-gated and tracked as its own task rather than silently deferred.
- **Three-stack operating cost** accepted for pilots; reviewed at the v2.0 trigger point (5–10 customers).
- **Scan-engine quality:** the Obvious-primary/Deepline-fallback split only pays off if the fallback is exercised — the weekly lead-quality test runs once against each engine.

## 11. Open questions (do not block the build)

1. **GCP credentials** — Richard provides via secrets flow; first deploy waits. Build and CI proceed without them.
2. **Pilot customer identities** — none named yet; D5's synthetic reference customer keeps the build unblocked.
3. **v2.0 pricing** — docs' tier table ($299–$999) is a draft for the productized phase; repricing after pilot learnings. Not load-bearing for v1.0.

## 12. Handoff

Sequence: D1+D2 (documents, parallelizable) alongside D3 scaffold → D5 (needs D2's compiler + D3 core agents) → D4 deploy scripts (needs D3) → Layer-2 recurring tests last against the reference deployment. One concern per subtask; every code subtask names its tests from §8.
