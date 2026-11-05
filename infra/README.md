# infra/

Per-customer deployment layer (spec deliverable D4): Terraform for `bloom-<customer>-prod` on
GCP (Cloud Run, Secret Manager, Cloud Logging) with Supabase/Cloud SQL Postgres + pgvector,
behind a deploy adapter so an Azure port stays config-level.

Scaffold only — the Terraform root and deploy adapter land with D4. Nothing here is deployed
yet; the first real cloud deploy is credential-gated (GCP credentials via the secrets flow).
