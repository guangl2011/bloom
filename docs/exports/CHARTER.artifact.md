# Bloom Product Charter — v3.0 (Service-First)

**Status:** Approved · Supersedes PRD v1.0 and Roadmap v2.2 sequencing
**Owner:** Richard Lu (Spotlize) · **Spec:** Service-First Platform Spec v3.1 · **Date:** 2026-11-05

---

Bloom is a B2B Revenue Intelligence + Growth Agent Platform for industrial-manufacturing and B2B export companies going overseas. It helps them find market opportunities, spot purchase-intent signals, discover and score potential customers, and support sales conversion — starting as a custom service, becoming a subscription product only after the custom flows run clean.

This charter rewrites the commercial sequence of the product. **v1.0 ships as a service-first, single-tenant platform: three pilot customers, each on a customized Agent workflow deployed once per customer.** Only after those deployments run clean does v2.0 repackage the same engine as a multi-tenant subscription SaaS. The platform architecture — five layers, six agents, approval gates — does not change between the two. What changes is who it is sold to, how it is deployed, and how it is billed.

## 1. Platform Overview — Five Layers (unchanged)

Bloom is not a chatbot and not a set of single-purpose tools. It is a layered platform:

| Layer | What it does |
|---|---|
| **Revenue Intelligence** | Market mapping, competitor and purchase-signal analysis, keyword/intent clustering, opportunity scoring |
| **Agent Workflow** | The six named agents below, orchestrated through configurable, versioned, retryable workflows |
| **Data & Knowledge** | Company/contact/lead/opportunity/intent-signal data, memory and knowledge base, pgvector retrieval |
| **Growth Execution** | Outreach sequences, CRM advancement, ad recommendations — always through approval gates |
| **Private-domain Conversion** | CRM conversion tracking, opportunity advancement, revenue attribution back to the originating signal |

## 2. The Six-Agent Roster (unchanged)

Every agent keeps the boundaries set in the Architecture PRD v1.0. Boundaries are the product's safety story; they are never configurable off.

| Agent | Mission (v1.0, customized per customer intake) | Hard boundary |
|---|---|---|
| **Revenue Intelligence** | Market map, competitor scan, keyword/intent clusters, opportunity scoring; runs the recurring purchase-signal scan | No outreach, no CRM writes, no execution |
| **ICP** | Turns the customer's ideal-customer definition into per-customer scoring-model tuning | No outreach or ad execution |
| **Lead** | Discovers and scores companies/contacts to the contracted quota; enriches and maintains the lead pool | No auto-contact, no direct CRM updates |
| **Outreach** | Drafts personalized email sequences, queues them for approval, executes approved sends | Nothing sends without a recorded human approval |
| **Ad** | Read-only Google Ads and LinkedIn Ads status and campaign recommendations | Never spends, never modifies a live campaign in v1.0 |
| **Conversion** | Tracks opportunities in the customer's CRM, advances stages, attributes closed revenue to the originating signal | No CRM record modified without sign-off |

Approval gates are hard invariants in every version: email sends, CRM writes, ad-budget changes, bulk scans, large exports, high-cost model calls, and connections to customer production systems all require a recorded human approval decision. Every approval is audit-logged with the agent, prompt version, and cost.

## 3. Commercial Sequence — Service First

The original PRD v1.0 and Roadmap v2.2 sequenced the product first: pricing tiers from Month 2–3, multi-tenant cloud from Phase 2, customers subscribing to a platform nobody had validated. **That sequencing is superseded.** The sequence is now:

1. **v1.0 — Custom service (three pilots).** Each pilot customer gets a single-tenant deployment (`bloom-<customer>-prod`) on their own cloud project (GCP by default), running Agent workflows customized from their service package and their completed intake workbook. There are three stacks to operate by design: absolute data isolation per customer, failure isolation between pilots, and customization as per-deployment config rather than a feature-flag matrix.
2. **v2.0 — Productized SaaS (after the pilots run clean).** The same engine re-packages as a multi-tenant subscription platform: deploy once, customers subscribe. Multi-tenancy arrives in the data layer (per-workspace isolation and RBAC) plus subscription billing — not as a new architecture. The trigger to ship v2.0 is operational cost, roughly when the pilot count approaches 5–10 customers and running three-plus stacks starts to dominate.

No pricing tier is exposed to customers in v1.0. Billing in v1.0 exists only as internal credit accounting for cost tracking. v2.0 subscription pricing is decided after pilot learnings and is out of scope for this charter.

## 4. Service Packages → Agent Modules

Two annual-contract service packages, sold on top of Spotlize's GEO (generative-engine-optimization) main service, define which agent workflows a v1.0 deployment runs. A customer never gets an agent their package didn't buy — the workflow config omits the blocks, and the dashboard hides them.

| Service package | Modules purchased | Agents activated |
|---|---|---|
| **Intelligence Starter** (半年度基础服务) | **A** — Monthly AI opportunity brief (by the 1st of each month) · **B** — Overseas purchase-signal monitoring, monthly digest (≤20 matched signals) · **C** — Quarterly industry-trend report | Revenue Intelligence + ICP |
| **Lead Generation Pro** (年度旗舰服务) | All Intelligence Starter content, upgraded (bi-weekly briefs, weekly signals ≤50, monthly trend reports), **plus:** **D** — 50 scored leads/month (A/B/C tiers) · **E** — Deep AI customer profiles · **F** — Competitor tracking (monthly report, by the 5th) · **G** — Quarterly regional market analysis · **H** — Dedicated CSM | Revenue Intelligence + ICP + Lead + Outreach (email, approval-gated, CRM connect) + Conversion; Ad recommendations optional per intake |

The service-level commitments embedded in these packages — ≥50 valid leads/month, A-tier contact accuracy ≥85%, report delivery dates — are carried into the recurring functional test suite, so a broken core service promise is caught before a customer notices.

## 5. v1.0 / v2.0 Scope Boundary

| Concern | v1.0 (custom service) | v2.0 (productized SaaS) |
|---|---|---|
| Deployment | Single-tenant, one cloud project per customer, behind a deploy adapter (GCP default, Azure a config-level port) | Shared deployment, workspaces isolated at the data layer |
| Tenancy | One customer per deployment | `workspace_id` enforced at the query layer + per-workspace RBAC (columns exist from day one in v1.0, so this is a migration, not a rewrite) |
| Billing | Internal credit accounting only | Subscription billing (Stripe/Paddle), pricing set post-pilot |
| Agent runtime | Hermes + Obvious automation layer (scheduled tasks carry schedules, retries, audit) | **Mastra upgrade behind AgentInterface** — every agent already implements the interface, so the swap is a compatibility exercise, not a rewrite |
| Scan engine | Swappable ScanEngineInterface — Obvious primary, Deepline fallback | Same interface, unchanged |
| Outreach | Email automation (draft → approval → send), CRM writes approval-queued | Automation layer upgraded; approval gates unchanged |
| Ads | Google Ads + LinkedIn Ads, read-only recommendations | Expanded per roadmap; spend execution remains gated |

The v2.0 design exists now (`docs/V2-MULTITENANT.md`) but is built only after the three pilots run clean.

## 6. Supersession

This charter supersedes the commercial sequencing of **PRD v1.0** (Bloom 6-Month PRD) and **Roadmap v2.2** (Bloom 12-Month Roadmap). The roadmap's architecture constraints — interface-first design, adapters for every external dependency, approval gates, versioned prompts/workflows/skills, `workspace_id` on every table — carry over unchanged as build invariants. The calendar sequencing (product-first pricing from Month 2–3, multi-tenant cloud from Phase 2, Mastra from Phase 3) does not carry over. The four original product-definition documents remain the reference for platform layers, agent boundaries, and service-package content; where they conflict with this charter on commercial sequence, this charter wins.
