/**
 * The engine gives states; the app writes the words (envelope §2).
 *
 *  - `__errors.<id>` binds a reason CODE, not a sentence in the engine's
 *    language (source-failure);
 *  - an app's message reads before a neutral fallback, placeholders filled
 *    (messages).
 *
 * @module @pwfabric/runtime/render/__tests__/app-words
 */
import { describe, expect, it } from 'vitest'
import { failureCodeOf, sourceFailureReason } from '../source-failure.js'
import { appMessagesOf, formatMessage, messageOf } from '../messages.js'

describe('sourceFailureReason — what __errors.<id> binds', () => {
  it('is a code for each failure, never a sentence', () => {
    expect(sourceFailureReason(401)).toBe('unauthenticated')
    expect(sourceFailureReason(403)).toBe('forbidden')
    expect(sourceFailureReason(404)).toBe('not_found')
    expect(sourceFailureReason(500)).toBe('server')
    expect(sourceFailureReason(503)).toBe('server')
    expect(sourceFailureReason(409)).toBe('conflict')
    expect(sourceFailureReason(422)).toBe('error')
    expect(sourceFailureReason('network')).toBe('network')
    expect(sourceFailureReason('unconnected')).toBe('unconnected')
    expect(sourceFailureReason('error')).toBe('error')
  })

  it('is truthy whatever the failure, so `if:` on it still tells failed from empty', () => {
    for (const code of [401, 403, 404, 500, 418, 'network', 'unconnected', 'error'] as const) {
      expect(Boolean(sourceFailureReason(code))).toBe(true)
    }
    expect(sourceFailureReason(failureCodeOf(new TypeError('Failed to fetch')))).toBe('network')
  })
})

describe('messages — the app’s word, else the fallback', () => {
  it('fills {name}, {code} and {n}; an unfilled placeholder is nothing', () => {
    expect(formatMessage('Hi {name} ({code}) #{n}', { name: 'Ada', code: 'X', n: 2 })).toBe('Hi Ada (X) #2')
    expect(formatMessage('Hi {name}')).toBe('Hi ')
    expect(formatMessage('{ not a placeholder }')).toBe('{ not a placeholder }')
  })

  it('reads a non-empty string the app sets, else the fallback', () => {
    expect(messageOf({ 'ui.close': 'Kapat' }, 'ui.close', 'Close')).toBe('Kapat')
    expect(messageOf({ 'ui.close': '' }, 'ui.close', 'Close')).toBe('Close')
    expect(messageOf(null, 'ui.close', 'Close')).toBe('Close')
    expect(messageOf({ 'ui.page': 'Sayfa {n}' }, 'ui.page', 'Page {n}', { n: 4 })).toBe('Sayfa 4')
  })

  it('keeps only string values of a messages map', () => {
    expect(appMessagesOf({ a: 'x', b: 2, c: { d: 'e' } })).toEqual({ a: 'x' })
    expect(appMessagesOf(['x'])).toEqual({})
    expect(appMessagesOf(undefined)).toEqual({})
  })
})
