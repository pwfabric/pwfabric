/**
 * Plurals in the app's messages (envelope §2.1): the ICU plural form
 * `{n, plural, =0 {…} one {# …} other {# …}}`, picked with the plural rules
 * of the app's locale (else `en`), `#` the number written in that locale.
 *
 * @module @pwfabric/runtime/render/__tests__/message-plurals
 */
import { describe, expect, it } from 'vitest'
import { formatMessage, messageOf, pluralProblems } from '../messages.js'

const BASKET = '{n, plural, =0 {Your basket is empty} one {# item in your basket} other {# items in your basket}}'

describe('formatMessage — plurals', () => {
  it('picks =N first, then the category of the number, then other', () => {
    expect(formatMessage(BASKET, { n: 0 })).toBe('Your basket is empty')
    expect(formatMessage(BASKET, { n: 1 })).toBe('1 item in your basket')
    expect(formatMessage(BASKET, { n: 3 })).toBe('3 items in your basket')
  })

  it("uses the locale's plural rules and writes # in its numbers", () => {
    const pl = '{n, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}'
    expect(formatMessage(pl, { n: 1 }, 'pl')).toBe('1 plik')
    expect(formatMessage(pl, { n: 3 }, 'pl')).toBe('3 pliki')
    expect(formatMessage(pl, { n: 5 }, 'pl')).toBe('5 plików')
    expect(formatMessage('{n, plural, other {# Artikel}}', { n: 1234.5 }, 'de-DE')).toBe('1.234,5 Artikel')
    // No locale: English.
    expect(formatMessage('{n, plural, one {# row} other {# rows}}', { n: 1000 })).toBe('1,000 rows')
  })

  it('fills the other placeholders inside the chosen branch and around it', () => {
    expect(formatMessage('Hi {name}: {n, plural, one {# message from {from}} other {# messages}}.', { name: 'Ada', n: 1, from: 'Bob' })).toBe(
      'Hi Ada: 1 message from Bob.'
    )
  })

  it('selects other for a value that is not a finite number and writes it as given', () => {
    expect(formatMessage('{n, plural, one {# item} other {# items}}', { n: 'many' })).toBe('many items')
    expect(formatMessage('{n, plural, one {# item} other {# items}}', {})).toBe(' items')
  })

  it('writes a message it does not understand as its text, braces and all', () => {
    for (const odd of [
      '{n, plural, one {# item}}',
      '{n, plural, one {# item} other {# items}',
      '{n, plural, few {a} few {b} other {c}}',
      '{n, plural, lots {a} other {b}}',
      '{g, select, a {x} other {y}}',
      '{n, plural, one {{m, plural, one {x} other {y}}} other {z}}',
    ]) {
      expect(formatMessage(odd, { n: 1, g: 'a', m: 1 }), odd).toBe(odd)
    }
  })

  it('keeps the placeholders and the plain braces it always had', () => {
    expect(formatMessage('Hello {name}, use { carefully', { name: 'Ada' })).toBe('Hello Ada, use { carefully')
    expect(formatMessage('{missing} ok', {})).toBe(' ok')
  })

  it('is what messageOf answers, in the locale it is given', () => {
    expect(messageOf({ 'cart.count': BASKET }, 'cart.count', undefined, { n: 2 })).toBe('2 items in your basket')
    expect(messageOf({ 'x': '{n, plural, one {# Datei} other {# Dateien}}' }, 'x', undefined, { n: 1000 }, 'de')).toBe('1.000 Dateien')
  })
})

describe('pluralProblems — what a validator reports', () => {
  it('finds nothing in a good plural, and in a message without one', () => {
    expect(pluralProblems(BASKET)).toEqual([])
    expect(pluralProblems('Hello {name}')).toEqual([])
  })

  it('names a missing other, an unknown selector, a repeated one, a plural in a branch, an unclosed brace, and select', () => {
    expect(pluralProblems('{n, plural, one {# item}}').join()).toMatch(/other/)
    expect(pluralProblems('{n, plural, lots {a} other {b}}').join()).toMatch(/selector/)
    expect(pluralProblems('{n, plural, one {a} one {b} other {c}}').join()).toMatch(/twice/)
    expect(pluralProblems('{n, plural, one {{m, plural, one {x} other {y}}} other {z}}').join()).toMatch(/inside/)
    expect(pluralProblems('{n, plural, one {a} other {b}').join()).toMatch(/closed/)
    expect(pluralProblems('{g, select, a {x} other {y}}').join()).toMatch(/select/)
  })
})
