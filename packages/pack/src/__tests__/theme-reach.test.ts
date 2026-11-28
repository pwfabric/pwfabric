import { describe, expect, it } from 'vitest'
import { checkThemeReach, isLiteralLook, packFromRecord, THEME_APP_UNREACHED, THEME_LITERAL_LOOK } from '../index.js'

const page = (appearance?: unknown, blocks: unknown[] = []) => JSON.stringify({ ...(appearance ? { appearance } : {}), blocks })
const codes = (files: Record<string, string>) => checkThemeReach(packFromRecord(files)).map((i) => i.code)

describe('THEME_APP_UNREACHED: every page names its own theme', () => {
  const app = { 'app/definitions/appearance.json': JSON.stringify({ use: 'theme-zinc' }) }
  it('warns when every page wears its own', () => {
    expect(codes({ ...app, 'app/surfaces/home.receipt.json': page({ use: 'theme-x' }), 'app/surfaces/plans.receipt.json': page({ use: 'theme-x' }) })).toEqual([THEME_APP_UNREACHED])
  })
  it('is quiet when one page wears the app’s (positive control: the same app, one page without)', () => {
    expect(codes({ ...app, 'app/surfaces/home.receipt.json': page({ use: 'theme-x' }), 'app/surfaces/plans.receipt.json': page() })).toEqual([])
  })
  it('is quiet when the app names no theme', () => {
    expect(codes({ 'app/surfaces/home.receipt.json': page({ use: 'theme-x' }) })).toEqual([])
  })
})

describe('THEME_LITERAL_LOOK: a fixed corner radius or shadow in a page', () => {
  it('warns once per page, naming the first value', () => {
    const issues = checkThemeReach(
      packFromRecord({
        'app/surfaces/home.receipt.json': page(undefined, [
          { id: 'nav', type: 'container', style: { borderRadius: '999px' }, children: [{ id: 'card', type: 'card', props: { borderRadius: '1.4rem' } }] },
        ]),
      }),
    )
    expect(issues.map((i) => i.code)).toEqual([THEME_LITERAL_LOOK])
    expect(issues[0]!.message).toMatch(/^2 corner radius/)
    expect(issues[0]!.message).toContain('borderRadius "999px" on "nav"')
  })
  it('passes theme references, circles, zero and none; judges each breakpoint', () => {
    for (const ok of ['var(--pw-border-radius-full)', '50%', '0', 'none', '0 0 var(--pw-border-radius) var(--pw-border-radius)']) expect(isLiteralLook('borderRadius', ok), ok).toBe(false)
    expect(isLiteralLook('boxShadow', 'var(--pw-shadow-lg)')).toBe(false)
    expect(isLiteralLook('boxShadow', '0 8px 24px rgba(0,0,0,.2)')).toBe(true)
    expect(isLiteralLook('borderRadius', 12)).toBe(true)
    expect(codes({ 'app/surfaces/a.receipt.json': page(undefined, [{ id: 'x', type: 'card', style: { borderRadius: { xs: '0', md: '12px' } } }]) })).toEqual([THEME_LITERAL_LOOK])
    expect(codes({ 'app/surfaces/a.receipt.json': page(undefined, [{ id: 'x', type: 'card', style: { borderRadius: 'var(--pw-border-radius-lg)' } }]) })).toEqual([])
  })
})

describe('the theme checks do not cry wolf (review)', () => {
  const app = { 'app/definitions/appearance.json': JSON.stringify({ use: 'theme-zinc' }) }
  it('pages that only change some tokens are drawn over the app theme: not unreached', () => {
    expect(codes({ ...app, 'app/surfaces/a.receipt.json': page({ theme: { colors: { primary: '#000000' } } }) })).toEqual([])
  })
  it('pages that name the app’s own theme do not replace it', () => {
    expect(codes({ ...app, 'app/surfaces/a.receipt.json': page({ use: 'theme-zinc' }) })).toEqual([])
  })
  it('an app with an inline theme is unreached when every page names another', () => {
    expect(codes({ 'app/definitions/appearance.json': JSON.stringify({ theme: { colors: {} } }), 'app/surfaces/a.receipt.json': page({ use: 'theme-x' }) })).toEqual([THEME_APP_UNREACHED])
  })
  it('a value that reads a theme var anywhere, or a zero in any unit, is not fixed', () => {
    for (const ok of ['calc(var(--pw-border-radius) - 2px)', '0rem', '0 0', '0 0 0 1px var(--pw-color-border)']) expect(isLiteralLook('boxShadow', ok), ok).toBe(false)
    expect(isLiteralLook('borderRadius', '0.5rem')).toBe(true)
  })
})
