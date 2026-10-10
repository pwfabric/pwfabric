/**
 * The appearance runtime: the mode policy decides the dark rule, a high-contrast config pushes inks further,
 * controls inherit the surface font, a sort written as an object is
 * honoured and `today()` exists, and pack manifests are enforced as
 * warnings. Each fix sits next to a positive control.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildDarkThemeCss } from '../render/dark-theme-css.js'
import { resolveAppearanceVars } from '../render/appearance-resolver.js'
import { applyEntityQuery, normalizeEntitySort } from '../entity/apply-query.js'
import { DEFAULT_BINDING_HELPERS } from '../binding/expression.js'
import { blockManifestPropFindings, manifestPropFindings } from '../surface/validation.js'
import { interpretSurface } from '../surface/interpreter.js'
import { hexToRgb, relativeLuminance } from '@pwfabric/contracts'

function ratio(a: string, b: string): number {
  const ra = hexToRgb(a)!
  const rb = hexToRgb(b)!
  const la = relativeLuminance(ra.r, ra.g, ra.b)
  const lb = relativeLuminance(rb.r, rb.g, rb.b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('C1 · mode policy decides the dark rule', () => {
  const vars = { '--pw-color-background': '#0b0b0b' }

  it('system (the default) keeps both the manual and the device rule', () => {
    const css = buildDarkThemeCss(vars, 's1')
    expect(css).toContain('[data-pw-theme="dark"]')
    expect(css).toContain('prefers-color-scheme:dark')
  })

  it('light emits no dark rule at all (M1: 12/12 apps went dark on a dark device)', () => {
    expect(buildDarkThemeCss(vars, 's1', 'light')).toBe('')
  })

  it('dark wears the dark palette unconditionally', () => {
    const css = buildDarkThemeCss(vars, 's1', 'dark')
    expect(css).not.toContain('prefers-color-scheme')
    expect(css).toContain('--pw-color-background:#0b0b0b !important')
  })

  it('a high-contrast config pushes the button ink to 7:1', () => {
    // Positive control: at normal contrast this ink stops at the AA line.
    const theme = { colors: { primary: '#1e3a8a', textOnPrimary: '#93c5fd' } }
    const normal = resolveAppearanceVars({ config: { theme } })
    const high = resolveAppearanceVars({ config: { theme, mode: { contrast: 'high' } } as never })
    const n = ratio(normal['--pw-color-text-on-primary']!, '#1e3a8a')
    expect(n).toBeGreaterThanOrEqual(4.5)
    expect(n).toBeLessThan(7)
    expect(normal['--pw-color-text-on-primary']).toBe('#93c5fd')
    expect(ratio(high['--pw-color-text-on-primary']!, '#1e3a8a')).toBeGreaterThanOrEqual(7)
  })
})

describe('C10 · a sort written as an object is honoured', () => {
  const rows = [
    { id: 1, date: '2026-10-03', title: 'b' },
    { id: 2, date: '2026-10-01', title: 'c' },
    { id: 3, date: '2026-10-02', title: 'a' },
  ]

  it('positive control: the contract array shape sorted before and still does', () => {
    const out = applyEntityQuery(rows, { sort: [{ field: 'date', direction: 'asc' }] })
    expect(out.items.map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('a single { field, direction } object sorts (it used to be dropped)', () => {
    const out = applyEntityQuery(rows, { sort: { field: 'date', direction: 'desc' } as never })
    expect(out.items.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('a field → direction map and a "-field" string sort too', () => {
    expect(applyEntityQuery(rows, { sort: { title: 'asc' } as never }).items.map((r) => r.id)).toEqual([3, 1, 2])
    expect(applyEntityQuery(rows, { sort: '-date' as never }).items.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('normalises every shape and drops what is not a sort', () => {
    expect(normalizeEntitySort({ field: 'a' })).toEqual([{ field: 'a', direction: 'asc' }])
    expect(normalizeEntitySort([{ field: 'a', direction: 'DESC' }, { nope: 1 }, 'b'])).toEqual([
      { field: 'a', direction: 'desc' },
      { field: 'b', direction: 'asc' },
    ])
    expect(normalizeEntitySort(undefined)).toEqual([])
    expect(normalizeEntitySort(42)).toEqual([])
    expect(normalizeEntitySort('-')).toEqual([])
  })
})

describe('C10 · today()', () => {
  afterEach(() => vi.useRealTimers())

  it('is the local date as YYYY-MM-DD, shiftable by whole days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0))
    const today = DEFAULT_BINDING_HELPERS['today']!
    expect(today()).toBe('2026-09-30')
    expect(today(1)).toBe('2026-10-01')
    expect(today(-30)).toBe('2026-08-31')
    // Compares as a string against stored dates: "upcoming".
    expect('2026-10-02' >= (today() as string)).toBe(true)
    expect('2026-09-29' >= (today() as string)).toBe(false)
  })
})

describe('C9 · pack manifests are enforced as warnings', () => {
  const manifests = {
    heading: [{ name: 'text' }, { name: 'level', bindable: false }],
    image: [{ name: 'src' }, { name: 'alt' }],
  }

  it('a clean block has no finding (negative control)', () => {
    expect(blockManifestPropFindings('heading', { text: '{{title}}', level: 2 }, manifests.heading)).toEqual([])
  })

  it('names a prop the manifest does not declare', () => {
    const f = blockManifestPropFindings('heading', { text: 'Hi', tone: 'inverse' }, manifests.heading)
    expect(f).toEqual([expect.objectContaining({ prop: 'tone', code: 'UNKNOWN_PROP', severity: 'warning' })])
  })

  it('names a template on a bindable:false prop, nested values included', () => {
    const f = blockManifestPropFindings('heading', { level: '{{lvl}}' }, manifests.heading)
    expect(f[0]).toMatchObject({ prop: 'level', code: 'TEMPLATE_ON_UNBINDABLE' })
    const nested = blockManifestPropFindings(
      'x',
      { opts: { label: 'a {{b}}' } },
      [{ name: 'opts', bindable: false }]
    )
    expect(nested).toHaveLength(1)
  })

  it('walks the tree with paths and skips block types it has no manifest for', () => {
    const layout = {
      type: 'section',
      props: { anything: 1 },
      children: [
        { type: 'heading', props: { text: 'a', paddingY: '12px' } },
        { type: 'image', props: { src: 'x', alt: 'y' } },
      ],
    }
    const f = manifestPropFindings(layout, manifests)
    expect(f).toEqual([expect.objectContaining({ path: 'root.children[0]', prop: 'paddingY' })])
  })

  it('interpretSurface reports them as warnings and still succeeds (no hard fail)', () => {
    const json = {
      id: 's1',
      version: '1.0.0',
      environment: 'web',
      layout: { type: 'heading', props: { text: 'a', tone: 'x' } },
    }
    const res = interpretSurface(json as never, { validation: { manifests } })
    expect(res.success).toBe(true)
    expect(res.success && res.warnings?.map((w) => w.code)).toEqual(['UNKNOWN_PROP'])
    // Without manifests, nothing changes.
    const plain = interpretSurface(json as never)
    expect(plain.success && plain.warnings).toBeUndefined()
  })
})
