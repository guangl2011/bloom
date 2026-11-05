/**
 * Email provider port (spec locked decision 5 — email automation first).
 *
 * The adapter never talks to a vendor directly; it calls an EmailProvider.
 * Two implementations exist:
 *  - the stub, which records sends in memory and cannot touch a network —
 *    the only provider test and e2e environments can construct;
 *  - the HTTP relay provider, which requires operational mode, the explicit
 *    BLOOM_ALLOW_REAL_SENDS=1 flag, and relay credentials — any missing
 *    condition refuses construction (zero-send guarantee).
 */

import { realSendStartupProblems } from '@bloom/svc-approval/zero-send'
import type { SendSafetyEnv } from '@bloom/svc-approval/zero-send'

export type EmailProviderId = 'stub' | 'http'

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly draftId: string
}

export interface EmailSendReceipt {
  readonly messageId: string
  readonly provider: EmailProviderId
}

export interface EmailProvider {
  readonly id: EmailProviderId
  send(message: EmailMessage): Promise<EmailSendReceipt>
}

export interface StubEmailProvider extends EmailProvider {
  readonly id: 'stub'
  /** Every send this provider recorded — the zero-network send log tests assert on. */
  readonly sent: readonly (EmailMessage & EmailSendReceipt)[]
}

/** Test provider stub: records the send, never reaches a network. */
export function createStubEmailProvider(): StubEmailProvider {
  const sent: (EmailMessage & EmailSendReceipt)[] = []
  return {
    id: 'stub',
    sent,
    async send(message: EmailMessage): Promise<EmailSendReceipt> {
      const receipt: EmailSendReceipt = { messageId: `stub-msg-${sent.length + 1}`, provider: 'stub' }
      sent.push({ ...message, ...receipt })
      return receipt
    },
  }
}

export const EMAIL_RELAY_CREDENTIAL_VARS = ['EMAIL_RELAY_URL', 'EMAIL_RELAY_TOKEN'] as const

/**
 * Problems blocking real email-relay construction in this environment; empty
 * means the provider may be constructed. Exported so the e2e zero-send guard
 * can assert the refusal without attempting a network call.
 */
export function httpEmailProviderProblems(env: SendSafetyEnv): string[] {
  return realSendStartupProblems(env, EMAIL_RELAY_CREDENTIAL_VARS)
}

/**
 * Real provider: POSTs the message to a configured email relay (an SMTP
 * gateway service under the deployment's control — no vendor SDK in-process).
 * Construction refuses unless the zero-send guard is satisfied for the given
 * environment, so a test process cannot obtain a network-capable provider.
 */
export function createHttpEmailProvider(env: SendSafetyEnv): EmailProvider {
  const problems = httpEmailProviderProblems(env)
  if (problems.length > 0) {
    throw new Error(
      `refusing to construct the http email provider — zero-send guarantee:\n  ${problems.join('\n  ')}`,
    )
  }
  const relayUrl = env.EMAIL_RELAY_URL as string
  const relayToken = env.EMAIL_RELAY_TOKEN as string
  return {
    id: 'http',
    async send(message: EmailMessage): Promise<EmailSendReceipt> {
      const response = await fetch(relayUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${relayToken}`,
        },
        body: JSON.stringify(message),
      })
      if (!response.ok) {
        throw new Error(`email relay failed with status ${response.status}`)
      }
      const body = (await response.json()) as { messageId?: unknown }
      if (typeof body.messageId !== 'string' || body.messageId === '') {
        throw new Error('email relay response did not include a messageId')
      }
      return { messageId: body.messageId, provider: 'http' }
    },
  }
}
