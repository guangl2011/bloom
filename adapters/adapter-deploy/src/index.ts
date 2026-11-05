/**
 * DeployAdapterInterface — the swappable cloud-deployment layer (spec deliverable D4).
 *
 * Each v1.0 customer gets a single-tenant deployment (`bloom-<customer>-prod`, GCP by
 * default). The adapter isolates the provider so an Azure port stays a new adapter
 * implementation — never a change to services, agents, or workflow code (spec decision 7).
 *
 * Hard rules:
 * - `apply` is credential-gated: with no cloud credentials it must refuse, never attempt
 *   a real deploy (the first real GCP deploy waits on credentials via the secrets flow).
 * - Cloud SDK imports are confined to this adapter (lint-enforced — see
 *   eslint.config.mjs and tests/deploy/import-boundary.test.ts).
 */

import { azureDeployAdapter } from './azure'
import { gcpDeployAdapter } from './gcp'

export type DeployProviderId = 'gcp' | 'azure'

export interface DeploymentSpec {
  /** Customer slug (lowercase, `[a-z0-9-]`) — drives the per-customer project name. */
  customer: string
  /** Deploy region. GCP default: us-central1. */
  region?: string
}

export interface ServicePlan {
  name: string
  port: number
  /** Cloud Run on GCP; Container Apps is the Azure-port equivalent. */
  kind: 'cloud_run' | 'container_apps'
}

export interface DeployPlan {
  provider: DeployProviderId
  /** Per-customer GCP project id, e.g. `bloom-reference-prod`. */
  project: string
  region: string
  services: ServicePlan[]
  database: { engine: 'postgres'; pgvector: boolean; tier: string }
  /** Secret Manager entries the deployment requires. */
  secrets: string[]
  /** Ordered Terraform steps this adapter drives (init → plan → apply). */
  steps: string[]
}

export interface DeployResult {
  ok: boolean
  /** Human-readable summary, safe for the audit log. */
  message: string
}

export interface DeployAdapter {
  readonly id: DeployProviderId
  /** Offline plan: what this provider would deploy for the spec. Makes no API calls. */
  plan(spec: DeploymentSpec): Promise<DeployPlan>
  /** Credential-gated: refuses without cloud credentials — never attempts a real deploy. */
  apply(spec: DeploymentSpec): Promise<DeployResult>
}

/**
 * Builds the per-customer project id and validates the customer slug it is derived
 * from — the slug becomes cloud resource names, so keep it a safe subset.
 */
export function projectIdFor(customer: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(customer)) {
    throw new Error(
      `invalid customer slug "${customer}" — expected 3-30 chars of [a-z0-9-] starting/ending alphanumeric`,
    )
  }
  return `bloom-${customer}-prod`
}

/** Returns the deploy adapter for a provider id. Unknown ids are a config error. */
export function getDeployAdapter(id: DeployProviderId): DeployAdapter {
  switch (id) {
    case 'gcp':
      return gcpDeployAdapter
    case 'azure':
      return azureDeployAdapter
    default:
      throw new Error(`unknown deploy provider "${String(id)}"`)
  }
}
