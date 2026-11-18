/**
 * The runner's words: the app's message first, then the neutral fallback.
 *
 * @module @pwfabric/runner/messages.test
 */
import { describe, expect, it } from 'vitest'
import {
  AUTH_ERROR_CODES,
  NEUTRAL_MESSAGES,
  PROVIDER_LABEL_METHODS,
  RUNNER_MESSAGES,
  RUNNER_MESSAGE_IDS,
  authErrorMessage,
  providerLabel,
  runnerMessages,
} from './messages.js'

describe('RUNNER_MESSAGES', () => {
  it('has a non-empty neutral fallback for every id', () => {
    for (const id of RUNNER_MESSAGE_IDS) expect(RUNNER_MESSAGES[id].trim()).not.toBe('')
  })

  it('has an auth.error id for every known code, and a provider label for every labelled method', () => {
    for (const code of AUTH_ERROR_CODES) expect(RUNNER_MESSAGE_IDS).toContain(`auth.error.${code}`)
    for (const m of PROVIDER_LABEL_METHODS) expect(RUNNER_MESSAGE_IDS).toContain(`gate.provider.${m}`)
  })

  it('carries the ids the server sentence and the greeting used to bypass', () => {
    expect(RUNNER_MESSAGES['session.refused']).toBeTruthy()
    expect(RUNNER_MESSAGES['account.greeting']).toBe('Welcome, {name}')
  })
})

describe('runnerMessages', () => {
  it('reads the app’s message first, then the fallback', () => {
    const say = runnerMessages({ 'gate.title': 'Oturum açın' })
    expect(say('gate.title')).toBe('Oturum açın')
    expect(say('gate.email')).toBe('Email')
  })

  it('fills {name}, {code} and {n}, and writes an unfilled placeholder as nothing', () => {
    const say = runnerMessages({ 'account.greeting': 'Hoş geldin, {name}', 'auth.error.unknown': '{code} · {n}' })
    expect(say('account.greeting', { name: 'Ayşe' })).toBe('Hoş geldin, Ayşe')
    expect(say('auth.error.unknown', { code: 'X', n: 2 })).toBe('X · 2')
    expect(NEUTRAL_MESSAGES('account.greeting')).toBe('Welcome, ')
  })

  it('ignores an empty or non-string message', () => {
    const say = runnerMessages({ 'gate.title': '', 'gate.body': 3 } as unknown as Record<string, string>)
    expect(say('gate.title')).toBe('Sign in')
    expect(say('gate.body')).toBe(RUNNER_MESSAGES['gate.body'])
  })

  it('does not read inherited keys as messages', () => {
    expect(runnerMessages({})('gate.or')).toBe('or')
    expect(runnerMessages(Object.create({ 'gate.or': 'x' }) as Record<string, string>)('gate.or')).toBe('or')
  })
})

describe('authErrorMessage', () => {
  it('reads auth.error.<code> for a known code, in any case, aliases included', () => {
    const say = runnerMessages({ 'auth.error.expired': 'Süresi doldu.' })
    expect(authErrorMessage(say, 'EXPIRED')).toBe('Süresi doldu.')
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'SIGN_IN_FAILED')).toBe(RUNNER_MESSAGES['auth.error.server_error'])
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'PROVIDER_REFUSED')).toBe(RUNNER_MESSAGES['auth.error.access_denied'])
    for (const code of AUTH_ERROR_CODES) {
      expect(authErrorMessage(NEUTRAL_MESSAGES, code.toUpperCase())).toBe(RUNNER_MESSAGES[`auth.error.${code}`])
    }
  })

  it('quotes an unknown plain code through auth.error.unknown, and never echoes anything else', () => {
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'weird_thing')).toBe('Sign-in failed (weird_thing). Try again.')
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'toString')).toBe('Sign-in failed (toString). Try again.')
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'Call +1 555 now')).toBe(RUNNER_MESSAGES['auth.error.generic'])
  })

  it('knows the codes `pwf dev`’s host sends', () => {
    // The dev host answers with codes from this list (cli host/local-host.ts),
    // so a refused round trip there reads the app's words, not `unknown`.
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'method_unavailable')).toBe(RUNNER_MESSAGES['auth.error.method_unavailable'])
    expect(authErrorMessage(NEUTRAL_MESSAGES, 'invalid_state')).toBe(RUNNER_MESSAGES['auth.error.invalid_state'])
  })
})

describe('providerLabel', () => {
  it('labels a known method from gate.provider.<method> and names an unknown one as itself', () => {
    const say = runnerMessages({ 'gate.provider.google': 'Google ile devam et' })
    expect(providerLabel(say, 'google')).toBe('Google ile devam et')
    expect(providerLabel(say, 'github')).toBe('Continue with GitHub')
    expect(providerLabel(say, 'okta')).toBe('okta')
  })
})
