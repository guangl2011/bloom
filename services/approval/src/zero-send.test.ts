/**
 * Zero-send guard unit tests: test-mode environments with real-send capability
 * fail the startup assertion; real providers cannot construct in test mode.
 */

import { describe, expect, it } from 'vitest'
import {
  assertSendStartupSafety,
  realSendStartupProblems,
  sendSafetyMode,
  testModeSendProblems,
} from './zero-send'

const TEST_ENV = { BLOOM_ENV: 'test' }
const PROD_ENV = { BLOOM_ENV: 'production', NODE_ENV: 'production' }

describe('zero-send — mode detection', () => {
  it('detects test mode from BLOOM_ENV or NODE_ENV', () => {
    expect(sendSafetyMode(TEST_ENV)).toBe('test')
    expect(sendSafetyMode({ NODE_ENV: 'test' })).toBe('test')
    expect(sendSafetyMode({})).toBe('operational')
    expect(sendSafetyMode(PROD_ENV)).toBe('operational')
  })
})

describe('zero-send — test-mode startup assertion', () => {
  it('passes a clean test environment', () => {
    expect(() => assertSendStartupSafety(TEST_ENV)).not.toThrow()
    expect(testModeSendProblems(TEST_ENV)).toEqual([])
  })

  it('fails startup when test mode carries a real-provider credential', () => {
    for (const credential of ['SENDGRID_API_KEY', 'SMTP_HOST', 'CRM_API_KEY', 'EMAIL_RELAY_URL']) {
      const problems = testModeSendProblems({ ...TEST_ENV, [credential]: 'secret' })
      expect(problems.some((problem) => problem.includes(credential))).toBe(true)
      expect(() => assertSendStartupSafety({ ...TEST_ENV, [credential]: 'secret' })).toThrow(
        /zero-send guarantee violated/,
      )
    }
  })

  it('fails startup when test mode selects a real provider', () => {
    expect(() => assertSendStartupSafety({ ...TEST_ENV, BLOOM_EMAIL_PROVIDER: 'http' })).toThrow(
      /BLOOM_EMAIL_PROVIDER=http/,
    )
    expect(() => assertSendStartupSafety({ ...TEST_ENV, BLOOM_CRM_PROVIDER: 'rest' })).toThrow(
      /BLOOM_CRM_PROVIDER=rest/,
    )
    expect(() =>
      assertSendStartupSafety({ ...TEST_ENV, BLOOM_EMAIL_PROVIDER: 'stub' }),
    ).not.toThrow()
  })

  it('does not judge operational mode — real providers enforce their own conditions', () => {
    expect(testModeSendProblems({ ...PROD_ENV, SENDGRID_API_KEY: 'secret' })).toEqual([])
  })
})

describe('zero-send — real provider construction guard', () => {
  it('refuses construction in test mode even with the flag and credentials set', () => {
    const problems = realSendStartupProblems(
      { ...TEST_ENV, BLOOM_ALLOW_REAL_SENDS: '1', EMAIL_RELAY_URL: 'https://relay.example.com' },
      ['EMAIL_RELAY_URL', 'EMAIL_RELAY_TOKEN'],
    )
    expect(problems.some((problem) => problem.includes('test-mode'))).toBe(true)
  })

  it('refuses construction without the explicit operator flag', () => {
    const problems = realSendStartupProblems(
      { ...PROD_ENV, EMAIL_RELAY_URL: 'https://relay.example.com' },
      ['EMAIL_RELAY_URL'],
    )
    expect(problems.some((problem) => problem.includes('BLOOM_ALLOW_REAL_SENDS'))).toBe(true)
  })

  it('refuses construction with missing credentials', () => {
    const problems = realSendStartupProblems(
      { ...PROD_ENV, BLOOM_ALLOW_REAL_SENDS: '1' },
      ['CRM_BASE_URL', 'CRM_API_KEY'],
    )
    expect(problems).toHaveLength(2)
  })

  it('allows construction only with mode + flag + credentials all present', () => {
    const problems = realSendStartupProblems(
      { ...PROD_ENV, BLOOM_ALLOW_REAL_SENDS: '1', CRM_BASE_URL: 'https://crm.example.com', CRM_API_KEY: 'k' },
      ['CRM_BASE_URL', 'CRM_API_KEY'],
    )
    expect(problems).toEqual([])
  })
})
