/**
 * Zero-send guarantee (spec D3, task mustHave): test and e2e environments
 * cannot reach a real email or CRM provider — by startup assertion and by
 * provider-construction guard.
 *
 * Two layers, both fail-closed:
 *  1. `assertSendStartupSafety` — services fail startup when a test-mode
 *     environment carries real-provider credentials or selects a real
 *     provider. Called at service boot and in the e2e guard test.
 *  2. `realSendStartupProblems` — real provider constructors require ALL of:
 *     declared operational mode, `BLOOM_ALLOW_REAL_SENDS=1`, and credentials.
 *     A test process can therefore never construct a provider that could
 *     reach the network, even if the startup assertion is bypassed.
 */

/** Plain env view — injectable so the checks are pure and testable. */
export type SendSafetyEnv = Readonly<Record<string, string | undefined>>

/** Env vars whose presence signals a real, send-capable provider. */
export const REAL_SEND_CREDENTIAL_VARS = [
  'SENDGRID_API_KEY',
  'RESEND_API_KEY',
  'POSTMARK_API_KEY',
  'SMTP_HOST',
  'SMTP_PASSWORD',
  'EMAIL_RELAY_URL',
  'EMAIL_RELAY_TOKEN',
  'CRM_BASE_URL',
  'CRM_API_KEY',
  'HUBSPOT_TOKEN',
  'SALESFORCE_ACCESS_TOKEN',
] as const

/** Provider selections that reach the network (everything else is a stub). */
export const REAL_PROVIDER_SELECTIONS = ['http', 'rest'] as const

export type SendSafetyMode = 'test' | 'operational'

/** `BLOOM_ENV=test` or `NODE_ENV=test` puts the process in test mode. */
export function sendSafetyMode(env: SendSafetyEnv): SendSafetyMode {
  return env.BLOOM_ENV === 'test' || env.NODE_ENV === 'test' ? 'test' : 'operational'
}

function selectedProviders(env: SendSafetyEnv): string[] {
  const selections: string[] = []
  const email = env.BLOOM_EMAIL_PROVIDER
  const crm = env.BLOOM_CRM_PROVIDER
  if (email !== undefined && email !== '' && email !== 'stub' && email !== 'auto') {
    selections.push(`BLOOM_EMAIL_PROVIDER=${email}`)
  }
  if (crm !== undefined && crm !== '' && crm !== 'stub' && crm !== 'auto') {
    selections.push(`BLOOM_CRM_PROVIDER=${crm}`)
  }
  return selections
}

/**
 * Problems that make a test-mode environment send-capable. Empty = safe.
 * Operational mode is not judged here — real providers additionally enforce
 * their own construction conditions (see `realSendStartupProblems`).
 */
export function testModeSendProblems(env: SendSafetyEnv): string[] {
  if (sendSafetyMode(env) !== 'test') {
    return []
  }
  const problems: string[] = []
  for (const name of REAL_SEND_CREDENTIAL_VARS) {
    const value = env[name]
    if (value !== undefined && value !== '') {
      problems.push(`test-mode environment carries real-provider credential ${name}`)
    }
  }
  for (const selection of selectedProviders(env)) {
    problems.push(`test-mode environment selects a real provider: ${selection}`)
  }
  return problems
}

/** Throws listing every problem — service startup and the e2e guard test call this. */
export function assertSendStartupSafety(env: SendSafetyEnv): void {
  const problems = testModeSendProblems(env)
  if (problems.length > 0) {
    throw new Error(
      `zero-send guarantee violated — refusing to start with real-send capability in test mode:\n  ${problems.join('\n  ')}`,
    )
  }
}

/**
 * Problems that block constructing a REAL provider. All three conditions must
 * hold: declared operational mode, the explicit real-send allow flag, and the
 * credentials the provider needs. One missing condition = refuse.
 */
export function realSendStartupProblems(
  env: SendSafetyEnv,
  requiredCredentialVars: readonly string[],
): string[] {
  const problems: string[] = []
  if (sendSafetyMode(env) === 'test') {
    problems.push('test-mode environment (BLOOM_ENV/NODE_ENV) — real providers are never constructible in test mode')
  }
  if (env.BLOOM_ALLOW_REAL_SENDS !== '1') {
    problems.push('BLOOM_ALLOW_REAL_SENDS is not set to "1" — real sends require the explicit operator flag')
  }
  for (const name of requiredCredentialVars) {
    const value = env[name]
    if (value === undefined || value === '') {
      problems.push(`required credential ${name} is missing`)
    }
  }
  return problems
}
