# Bloom per-customer GCP deployment — Terraform root (spec deliverable D4).
#
# Deploys one customer's single-tenant project `bloom-<customer>-prod`:
# Cloud Run services, Cloud SQL Postgres (pgvector via extension), Secret
# Manager, and Cloud Logging. An Azure port adds infra/terraform-azure plus a
# new deploy adapter — no change to services, agents, or workflow code.
#
# No real apply has run yet: the first deploy is credential-gated (GCP
# credentials via the secrets flow). CI plans this root offline against
# tests/fixtures/deploy/reference.tfvars with throwaway generated credentials.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = local.project_id
  region  = var.gcp_region
}
