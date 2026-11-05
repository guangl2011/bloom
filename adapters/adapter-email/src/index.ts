/**
 * @bloom/adapter-email — email-first outreach behind the approval gate
 * (spec D3, locked decisions 5 and 10). Draft queue + hard-gated send.
 */

export { createEmailAdapter, InMemoryDraftOutbox } from './adapter'
export type {
  DraftOutbox,
  EmailAdapter,
  EmailAdapterDeps,
  QueuedEmailDraft,
} from './adapter'
export {
  createHttpEmailProvider,
  createStubEmailProvider,
  EMAIL_RELAY_CREDENTIAL_VARS,
  httpEmailProviderProblems,
} from './provider'
export type {
  EmailMessage,
  EmailProvider,
  EmailProviderId,
  EmailSendReceipt,
  StubEmailProvider,
} from './provider'
