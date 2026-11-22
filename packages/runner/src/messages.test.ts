/**
 * @vitest-environment jsdom
 *
 * The runner's words: the app's, and only the app's (E-4: the engine writes
 * no visitor word). A message the app does not set is drawn as nothing; a
 * control left without a word is named by its id.
 *
 * @module @pwfabric/runner/messages.test
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_ERROR_CODES,
  NO_MESSAGES,
  PROVIDER_LABEL_METHODS,
  RUNNER_MESSAGE_IDS,
  authErrorMessage,
  labelWith,
  providerLabel,
  runnerMessages,
} from './messages.js'
import * as runner from './index.js'

/** Every id written as itself: shows which id a lookup reads. */
const ECHO = runnerMessages(Object.fromEntries(RUNNER_MESSAGE_IDS.map((id) => [id, `<${id}>{code}`])))

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev
})

describe('RUNNER_MESSAGE_IDS', () => {
  it('has an auth.error id for every known code, and a provider label for every labelled method', () => {
    for (const code of AUTH_ERROR_CODES) expect(RUNNER_MESSAGE_IDS).toContain(`auth.error.${code}`)
    for (const m of PROVIDER_LABEL_METHODS) expect(RUNNER_MESSAGE_IDS).toContain(`gate.provider.${m}`)
  })

  it('is a list of ids, and the runner ships no table of words', () => {
    expect(new Set(RUNNER_MESSAGE_IDS).size).toBe(RUNNER_MESSAGE_IDS.length)
    expect(RUNNER_MESSAGE_IDS).toContain('session.refused')
    expect(RUNNER_MESSAGE_IDS).toContain('bridge.exchangeFailed')
    expect('RUNNER_MESSAGES' in runner).toBe(false)
  })
})

describe('runnerMessages', () => {
  it('writes a plural in the app’s locale', () => {
    const say = runnerMessages({ 'pill.signedIn': '{n, plural, one {# Sitzung} other {# Sitzungen}}' }, 'de')
    expect(say('pill.signedIn', { n: 1 })).toBe('1 Sitzung')
    expect(say('pill.signedIn', { n: 2000 })).toBe('2.000 Sitzungen')
  })

  it('reads the app’s message; an id it does not set is nothing', () => {
    const say = runnerMessages({ 'gate.title': 'Oturum açın' })
    expect(say('gate.title')).toBe('Oturum açın')
    expect(say('gate.email')).toBe('')
    for (const id of RUNNER_MESSAGE_IDS) expect(NO_MESSAGES(id)).toBe('')
  })

  it('fills {name}, {code} and {n}, and writes an unfilled placeholder as nothing', () => {
    const say = runnerMessages({ 'account.greeting': 'Hoş geldin, {name}', 'auth.error.unknown': '{code} · {n}' })
    expect(say('account.greeting', { name: 'Ayşe' })).toBe('Hoş geldin, Ayşe')
    expect(say('auth.error.unknown', { code: 'X', n: 2 })).toBe('X · 2')
    expect(say('account.greeting')).toBe('Hoş geldin, ')
  })

  it('ignores an empty or non-string message, and inherited keys', () => {
    const say = runnerMessages({ 'gate.title': '', 'gate.body': 3 } as unknown as Record<string, string>)
    expect(say('gate.title')).toBe('')
    expect(say('gate.body')).toBe('')
    expect(runnerMessages(Object.create({ 'gate.or': 'x' }) as Record<string, string>)('gate.or')).toBe('')
  })

  it('names a missing id in the console under pwf dev only, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    NO_MESSAGES('gate.close')
    expect(warn).not.toHaveBeenCalled()
    ;(globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev = true
    NO_MESSAGES('session.unexpected')
    NO_MESSAGES('session.unexpected')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('"session.unexpected"')
  })
})

describe('labelWith', () => {
  it('writes the word, and names a control by its id when the app set none', () => {
    const button = document.createElement('button')
    labelWith(button, 'Giriş yap', 'gate.signIn')
    expect(button.textContent).toBe('Giriş yap')
    expect(button.hasAttribute('aria-label')).toBe(false)
    labelWith(button, '', 'gate.signIn')
    expect(button.textContent).toBe('')
    expect(button.getAttribute('aria-label')).toBe('gate.signIn')
    const region = document.createElement('aside')
    labelWith(region, '', 'pill.region', 'aria-label')
    expect(region.getAttribute('aria-label')).toBe('pill.region')
    labelWith(region, 'Hesap', 'pill.region', 'aria-label')
    expect(region.getAttribute('aria-label')).toBe('Hesap')
  })
})

describe('authErrorMessage', () => {
  it('reads auth.error.<code> for a known code, in any case, aliases included', () => {
    const say = runnerMessages({ 'auth.error.expired': 'Süresi doldu.' })
    expect(authErrorMessage(say, 'EXPIRED')).toBe('Süresi doldu.')
    expect(authErrorMessage(ECHO, 'SIGN_IN_FAILED')).toBe('<auth.error.server_error>')
    expect(authErrorMessage(ECHO, 'PROVIDER_REFUSED')).toBe('<auth.error.access_denied>')
    for (const code of AUTH_ERROR_CODES) expect(authErrorMessage(ECHO, code.toUpperCase())).toBe(`<auth.error.${code}>`)
  })

  it('quotes an unknown plain code through auth.error.unknown, and never echoes anything else', () => {
    expect(authErrorMessage(ECHO, 'weird_thing')).toBe('<auth.error.unknown>weird_thing')
    expect(authErrorMessage(ECHO, 'toString')).toBe('<auth.error.unknown>toString')
    expect(authErrorMessage(ECHO, 'Call +1 555 now')).toBe('<auth.error.generic>')
  })

  it('knows the codes `pwf dev`’s host sends', () => {
    // The dev host answers with codes from this list (cli host/local-host.ts),
    // so a refused round trip there reads the app's words, not `unknown`.
    expect(authErrorMessage(ECHO, 'method_unavailable')).toBe('<auth.error.method_unavailable>')
    expect(authErrorMessage(ECHO, 'invalid_state')).toBe('<auth.error.invalid_state>')
  })
})

describe('providerLabel', () => {
  it('labels a known method from gate.provider.<method> and names an unknown one as itself', () => {
    const say = runnerMessages({ 'gate.provider.google': 'Google ile devam et' })
    expect(providerLabel(say, 'google')).toBe('Google ile devam et')
    expect(providerLabel(say, 'github')).toBe('')
    expect(providerLabel(say, 'okta')).toBe('okta')
  })
})
