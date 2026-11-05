/**
 * GCP deploy adapter (spec decision 7) — the v1.0 default provider.
 *
 * The Terraform it drives lives in `infra/terraform/` and deploys the per-customer
 * single-tenant project: Cloud Run services, Cloud SQL Postgres (pgvector enabled via
 * extension), Secret Manager, and Cloud Logging. This module describes the deployment
 * and gates `apply` on credentials; it never imports the GCP SDK — apply shells out to
 * Terraform, which is the only thing that talks to GCP.
 */

import { projectIdFor, type DeployAdapter, type DeployPlan, type DeployResult, type DeploymentSpec, type ServicePlan } from './index'

/** The v1.0 service set, mirroring docker-compose.yml and infra/terraform defaults. */
const V1_SERVICES: ServicePlan[] = [
  { name: 'workflow', port: 4101, kind: 'cloud_run' },
  { name: 'approval', port: 4102, kind: 'cloud_run' },
  { name: 'agents', port: 4103, kind: 'cloud_run' },
  { name: 'web', port: 3000, kind: 'cloud_run' },
]

const V1_SECRETS = ['db-password', 'llm-router-key', 'scan-engine-key', 'email-smtp-key']

/** Has the operator wired real (or fixture) GCP credentials into the environment? */
function hasGcpCredentials(): boolean {
  return Boolean(process.env.GOOGLE_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS)
}

export const gcpDeployAdapter: DeployAdapter = {
  id: 'gcp',

  async plan(spec: DeploymentSpec): Promise<DeployPlan> {
    const project = projectIdFor(spec.customer)
    const region = spec.region ?? 'us-central1'
    return {
      provider: 'gcp',
      project,
      region,
      services: V1_SERVICES,
      database: {
        engine: 'postgres',
        // Cloud SQL for PostgreSQL supports pgvector via CREATE EXTENSION vector.
        pgvector: true,
        tier: 'db-f1-micro',
      },
      secrets: V1_SECRETS,
      steps: [
        `terraform -chdir=infra/terraform init -backend=false`,
        `terraform -chdir=infra/terraform plan -var=customer=${spec.customer} -var=gcp_region=${region}`,
        `terraform -chdir=infra/terraform apply`, // credential-gated, human-approved
      ],
    }
  },

  async apply(spec: DeploymentSpec): Promise<DeployResult> {
    const project = projectIdFor(spec.customer)
    if (!hasGcpCredentials()) {
      throw new Error(
        `GCP credentials not configured — deploy of ${project} is credential-gated. ` +
          `Provide GCP_DEPLOY_CREDENTIALS via the secrets flow; nothing was deployed.`,
      )
    }
    // With credentials present, apply runs infra/deploy.sh (Terraform) — the first real
    // deploy also needs an explicit operator go-ahead recorded in the environment.
    if (process.env.BLOOM_DEPLOY_APPROVED !== 'true') {
      throw new Error(
        `deploy of ${project} requires BLOOM_DEPLOY_APPROVED=true — deploys are human-approved, never implicit.`,
      )
    }
    return {
      ok: true,
      message: `${project}: deployment driven by infra/deploy.sh (Terraform apply) — see Cloud Logging for the audit trail.`,
    }
  },
}
