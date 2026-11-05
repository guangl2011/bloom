# infra/

Per-customer deployment layer (spec deliverable D4). Each v1.0 customer gets a
single-tenant deployment — GCP project `bloom-<customer>-prod`: Cloud Run services,
Cloud SQL Postgres + pgvector, Secret Manager, and Cloud Logging with a dedicated
90-day audit bucket.

## Layout

- `terraform/` — the GCP Terraform root. An Azure port adds `terraform-azure/` plus
  a new adapter in `adapters/adapter-deploy/` — never a change to services or agents.
- `deploy.sh` — per-customer plan/apply driver. `apply` is double-gated: requires
  `GOOGLE_CREDENTIALS` (via the secrets flow) AND `BLOOM_DEPLOY_APPROVED=true`.
- `compose-local.sh` — compose-based local equivalent: same containers as the cloud
  deployment, isolated per customer via `COMPOSE_PROJECT_NAME=bloom-<customer>-local`.

## Status

Nothing is deployed yet — the first real cloud deploy is credential-gated (GCP
credentials via the secrets flow). CI validates offline: `terraform fmt -check`,
`validate`, and `plan` against `tests/fixtures/deploy/reference.tfvars` with
runtime-generated throwaway credentials (`tests/fixtures/deploy/gen-fixture-credentials.sh`),
plus a compose boot of the per-customer stack.

## Per-customer deploy (once credentials exist)

```bash
infra/deploy.sh <customer> plan    # offline plan, safe
infra/deploy.sh <customer> apply   # credential- and approval-gated
infra/compose-local.sh <customer>  # local equivalent (docker compose)
```
