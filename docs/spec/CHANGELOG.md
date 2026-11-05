# Changelog

All notable changes to the Bloom Service-First Platform Spec. Revisions during
development are explicit versions with entries here — never silent edits.

Any PR that modifies files under `docs/spec/` must add an entry to this file;
a CI lint check fails otherwise.

## [3.1] — 2026-11-05

Simplification review (Richard Lu). Key changes vs v3.0:

- **Removed from scan-engine adapter set:** Visible API (insufficient precision),
  Apify and Tinyfish crawlers (general-purpose crawler precision too low for
  purchase-signal scanning).
- **Scan engine:** swappable `ScanEngineInterface` with **Obvious as primary
  research engine and Deepline as configured fallback**.
- **Agent runtime:** Mastra deferred to **v2.0** behind AgentInterface; v1.0 runs
  **Hermes + Obvious automation** (Obvious scheduled tasks carry schedules,
  retries, audit).
- **Lead scoring:** internal model (`internal_v1`) tuned per customer from intake
  ICP criteria.
- **Outreach:** email automation first (draft → approval → send) with CRM connect
  via approval-queued crm-write adapter.
- **Ads:** limited to **Google Ads and LinkedIn Ads only**, read-only
  recommendations in v1.0.
- Seeded this changelog and the CI lint check enforcing changelog updates for
  spec changes.

## [3.0] — 2026-11-05

Initial service-first spec. Supersedes PRD v1.0 / Roadmap v2.2 sequencing:
v1.0 ships as single-tenant per-customer deployments (three pilots) on Hermes +
Obvious automation; v2.0 re-packages as multi-tenant subscription SaaS with
Mastra. Seven deliverables (D1–D7) with verifiable acceptance criteria.
