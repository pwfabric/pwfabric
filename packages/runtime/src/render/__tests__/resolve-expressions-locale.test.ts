/**
 * #8 — dates and numbers are written in the APP's locale.
 *
 * `date()` used the browser's default, so an en-GB café showed `11/17/2026`
 * to a visitor whose browser said en-US, and `1.234,5` to one in de-DE. The
 * app declares its locale (`app/plan.json` `locale`); the renderer writes in
 * it.
 *
 * @module @pwfabric/runtime/render/__tests__/resolve-expressions-locale
 */
import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { resolveBlockExpressions } from '../resolve-expressions.js'

const block = (text: string): Block => ({ id: 't', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { text } }) as Block
const text = (template: string, data: Record<string, unknown>, locale?: string): unknown =>
  resolveBlockExpressions([block(template)], data, undefined, locale ? { locale } : {})[0]!.props!['text']

const DAY = '2026-11-17T12:00:00Z'

describe('locale-aware formatting', () => {
  it('date() writes in the app locale', () => {
    expect(text('{{date(state.d)}}', { state: { d: DAY } }, 'en-GB')).toBe('17/11/2026')
    expect(text('{{date(state.d)}}', { state: { d: DAY } }, 'en-US')).toBe('11/17/2026')
  })

  it('a number written for people uses the app locale — number(), currency(), toLocaleString()', () => {
    const data = { state: { n: 1234.5 } }
    expect(text('{{number(state.n)}}', data, 'de-DE')).toBe('1.234,5')
    expect(text('{{number(state.n, 2)}}', data, 'en-GB')).toBe('1,234.50')
    expect(text('{{state.n.toLocaleString()}}', data, 'de-DE')).toBe('1.234,5')
    expect(text("{{currency(state.n, 'GBP')}}", data, 'en-GB')).toBe('£1,234.50')
  })

  it('an explicit currency locale still wins', () => {
    expect(text("{{currency(state.n, 'EUR', 'de-DE')}}", { state: { n: 3 } }, 'en-GB')).toMatch(/^3,00\s€$/)
  })

  it('an unknown locale tag falls back instead of throwing', () => {
    expect(text('{{number(state.n)}}', { state: { n: 1 } }, 'not a locale!')).toBe('1')
  })
})
