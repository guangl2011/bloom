import { describe, expect, it } from 'vitest'
import { getDeployAdapter, projectIdFor, type DeployAdapter } from './index'

describe('projectIdFor', () => {
  it('builds the per-customer project id', () => {
    expect(projectIdFor('reference')).toBe('bloom-reference-prod')
  })

  it('rejects slugs unsafe for cloud resource names', () => {
    for (const bad of ['', 'A', 'ab', '-lead', 'lead-', 'Shanghai_Factory', 'x'.repeat(31)]) {
      expect(() => projectIdFor(bad)).toThrow(/invalid customer slug/)
    }
  })
})

describe('adapter registry', () => {
  it('returns the adapter for each provider id', () => {
    expect(getDeployAdapter('gcp').id).toBe('gcp')
    expect(getDeployAdapter('azure').id).toBe('azure')
  })

  it('throws on an unknown provider id', () => {
    expect(() => getDeployAdapter('visible-api' as never)).toThrow(/unknown deploy provider/)
  })
})

describe('gcp adapter (v1.0 default)', () => {
  const gcp: DeployAdapter = getDeployAdapter('gcp')

  it('plans the full per-customer deployment offline', async () => {
    const plan = await gcp.plan({ customer: 'reference' })
    expect(plan.provider).toBe('gcp')
    expect(plan.project).toBe('bloom-reference-prod')
    expect(plan.region).toBe('us-central1')
    expect(plan.services.map((s) => s.name)).toEqual(['workflow', 'approval', 'agents', 'web'])
    expect(plan.database).toMatchObject({ engine: 'postgres', pgvector: true })
    expect(plan.secrets.length).toBeGreaterThanOrEqual(3)
    expect(plan.steps.some((s) => s.includes('terraform plan'))).toBe(true)
  })

  it('honors a customer-specified region', async () => {
    const plan = await gcp.plan({ customer: 'reference', region: 'asia-east2' })
    expect(plan.region).toBe('asia-east2')
  })

  it('refuses to apply without cloud credentials (first deploy is credential-gated)', async () => {
    const saved = { creds: process.env.GOOGLE_CREDENTIALS, approved: process.env.BLOOM_DEPLOY_APPROVED }
    delete process.env.GOOGLE_CREDENTIALS
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    delete process.env.BLOOM_DEPLOY_APPROVED
    try {
      await expect(gcp.apply({ customer: 'reference' })).rejects.toThrow(/credential-gated/)
    } finally {
      process.env.GOOGLE_CREDENTIALS = saved.creds
      process.env.BLOOM_DEPLOY_APPROVED = saved.approved
    }
  })

  it('requires explicit human approval even when credentials exist', async () => {
    const saved = process.env.BLOOM_DEPLOY_APPROVED
    process.env.GOOGLE_CREDENTIALS = '{"type":"service_account"}'
    delete process.env.BLOOM_DEPLOY_APPROVED
    try {
      await expect(gcp.apply({ customer: 'reference' })).rejects.toThrow(/BLOOM_DEPLOY_APPROVED/)
    } finally {
      process.env.GOOGLE_CREDENTIALS = undefined
      process.env.BLOOM_DEPLOY_APPROVED = saved
    }
  })
})

describe('azure adapter (config-level port)', () => {
  const azure: DeployAdapter = getDeployAdapter('azure')

  it('plans the same deployment shape on Container Apps', async () => {
    const plan = await azure.plan({ customer: 'reference' })
    expect(plan.provider).toBe('azure')
    expect(plan.project).toBe('bloom-reference-prod')
    expect(plan.services.every((s) => s.kind === 'container_apps')).toBe(true)
  })

  it('refuses apply — the Azure port lands in v2.0', async () => {
    await expect(azure.apply({ customer: 'reference' })).rejects.toThrow(/config-level port/)
  })
})
