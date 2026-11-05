/**
 * Azure deploy adapter — proves the Azure port is a new adapter implementation only
 * (spec decision 7): same DeployAdapter interface, zero changes elsewhere.
 *
 * Not implemented in v1.0 (the docs lock GCP for the pilots); planning works so the
 * port shape can be reviewed and tested, but apply is refused until the port is funded.
 */

import { projectIdFor, type DeployAdapter, type DeployPlan, type DeployResult, type DeploymentSpec, type ServicePlan } from './index'

const AZURE_SERVICES: ServicePlan[] = [
  { name: 'workflow', port: 4101, kind: 'container_apps' },
  { name: 'approval', port: 4102, kind: 'container_apps' },
  { name: 'agents', port: 4103, kind: 'container_apps' },
  { name: 'web', port: 3000, kind: 'container_apps' },
]

const AZURE_SECRETS = ['db-password', 'llm-router-key', 'scan-engine-key', 'email-smtp-key']

export const azureDeployAdapter: DeployAdapter = {
  id: 'azure',

  async plan(spec: DeploymentSpec): Promise<DeployPlan> {
    const project = projectIdFor(spec.customer)
    return {
      provider: 'azure',
      project,
      region: spec.region ?? 'eastus',
      services: AZURE_SERVICES,
      database: { engine: 'postgres', pgvector: true, tier: 'B_Standard_B1ms' },
      secrets: AZURE_SECRETS,
      steps: [
        `terraform -chdir=infra/terraform-azure init -backend=false`,
        `terraform -chdir=infra/terraform-azure plan -var=customer=${spec.customer}`,
        `terraform -chdir=infra/terraform-azure apply`, // credential-gated, human-approved
      ],
    }
  },

  async apply(_spec: DeploymentSpec): Promise<DeployResult> {
    throw new Error(
      'azure deploy adapter is a config-level port (spec decision 7) — not implemented in v1.0; nothing was deployed.',
    )
  },
}
