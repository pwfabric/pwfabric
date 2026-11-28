import { describe, expect, it } from 'vitest'
import { AtomBlockDefinitionMetadataSchema } from '../../fabric/atom.schema.js'
import {
  blockTokenDescriptors,
  blockTokenProperty,
  blockTokenValueProblem,
  blockTokenVars,
  DEFAULT_APPEARANCE_THEME,
  mergeSurfaceThemes,
  mergeThemeBlocks,
  resolveDarkTheme,
  surfaceThemeToCSS,
} from '../../index.js'

describe('block tokens: names, types, merge, emission', () => {
  it('a token is emitted as --pw-<block>-<kebab-token>', () => {
    expect(blockTokenProperty('sidebar', 'itemPaddingBlock')).toBe('--pw-sidebar-item-padding-block')
    expect(blockTokenProperty('table-of-contents', 'ink')).toBe('--pw-table-of-contents-ink')
  })

  it('each type takes its values, and a var() reference everywhere', () => {
    for (const ok of ['#2eb8aa', '#fff', 'rgba(0, 0, 0, 0.03)', 'oklch(0.7 0.1 180)', 'color-mix(in srgb, red 10%, transparent)', 'transparent', 'var(--pw-color-primary)']) {
      expect(blockTokenValueProblem('color', ok)).toBeUndefined()
    }
    // A bare 0 is refused: a length token may sit inside calc(), where 0 is a number, not a length.
    expect(blockTokenValueProblem('length', '0')).toMatch(/bare 0/)
    for (const ok of ['0px', '6px', '1.25rem', '0.9em', '50%', 'calc(100% - 2px)', 'var(--pw-space-xs)']) expect(blockTokenValueProblem('length', ok)).toBeUndefined()
    for (const ok of ['1.5', '2', 'var(--pw-line-height-body)']) expect(blockTokenValueProblem('number', ok)).toBeUndefined()
    for (const ok of ['400', '700', 'bold', 'var(--pw-font-weight-heading)']) expect(blockTokenValueProblem('fontWeight', ok)).toBeUndefined()
    for (const ok of ['1.5', '24px', 'normal', 'var(--pw-line-height-body)']) expect(blockTokenValueProblem('lineHeight', ok)).toBeUndefined()
    expect(blockTokenValueProblem('lineHeight', 'tall')).toMatch(/not a line height/)
    for (const type of ['color', 'length', 'number', 'fontWeight', 'lineHeight'] as const) expect(blockTokenValueProblem(type, 'inherit')).toBeUndefined()
    expect(blockTokenValueProblem('length', '6')).toMatch(/not a length/)
    expect(blockTokenValueProblem('length', '6px 8px')).toMatch(/not a length/)
    expect(blockTokenValueProblem('color', '12px')).toMatch(/not a colour/)
    expect(blockTokenValueProblem('fontWeight', '1200')).toMatch(/not a font weight/)
    expect(blockTokenValueProblem('number', '1.5px')).toMatch(/not a number/)
    expect(blockTokenValueProblem('color', 'red; } body { x')).toMatch(/CSS value cannot/)
    // An escape, an open bracket or an open quote would carry the next declarations in.
    for (const bad of ['red\\', 'calc(1px', "'x", 'var(--a))']) expect(blockTokenValueProblem('length', bad), bad).toMatch(/CSS value cannot/)
    for (const ok of ['1dvw', '2cqi', '3vb']) expect(blockTokenValueProblem('length', ok), ok).toBeUndefined()
    expect(blockTokenValueProblem('color', 3 as unknown as string)).toMatch(/not a non-empty string/)
  })

  it('blocks merge per block, per token, later layers winning', () => {
    expect(mergeThemeBlocks({ sidebar: { a: '1px', b: '2px' } }, { sidebar: { b: '3px' }, prose: { c: 'red' } })).toEqual({ sidebar: { a: '1px', b: '3px' }, prose: { c: 'red' } })
    expect(mergeThemeBlocks(undefined, 'x', [])).toBeUndefined()
    expect(mergeSurfaceThemes({ blocks: { sidebar: { a: '1px', b: '2px' } } }, { blocks: { sidebar: { b: '3px' } } }).blocks).toEqual({ sidebar: { a: '1px', b: '3px' } })
  })

  it('emits only well-formed names and safe values', () => {
    expect(blockTokenVars({ sidebar: { rowGap: '4px', 'bad-name': '1px', evil: 'x;}' }, 'Bad Block': { a: '1px' } })).toEqual({ '--pw-sidebar-row-gap': '4px' })
  })

  it('the theme emits its blocks group, light and dark, and per-level heading weight and line height', () => {
    const theme = { typography: { headingWeight: '600', headingWeightH1: '700', headingLineHeightH2: '36px' }, blocks: { sidebar: { currentInk: '#218379' } } }
    const light = surfaceThemeToCSS(theme, DEFAULT_APPEARANCE_THEME)
    expect(light['--pw-sidebar-current-ink']).toBe('#218379')
    expect(light['--pw-font-weight-h1']).toBe('700')
    expect(light['--pw-font-weight-h2']).toBe('var(--pw-font-weight-heading)')
    expect(light['--pw-line-height-h2']).toBe('36px')
    expect(light['--pw-line-height-h6']).toBe('var(--pw-line-height-heading)')
    const full = mergeSurfaceThemes(DEFAULT_APPEARANCE_THEME, theme)
    const dark = surfaceThemeToCSS(resolveDarkTheme(full, { blocks: { sidebar: { currentInk: '#51c8b8' } } }))
    expect(dark['--pw-sidebar-current-ink']).toBe('#51c8b8')
  })

  it('a theme without blocks or per-level headings emits what it did (per-level vars follow the heading tokens)', () => {
    const vars = surfaceThemeToCSS({ colors: { primary: '#000' } }, DEFAULT_APPEARANCE_THEME)
    expect(Object.keys(vars).some((k) => /^--pw-[a-z-]+-[a-z]/.test(k) && k.startsWith('--pw-sidebar'))).toBe(false)
  })
})

describe('block manifest: definition.tokens', () => {
  const base = { props: [], defaultProps: {}, canHaveChildren: false }
  it('declares look tokens with a name, a type, a default and a description', () => {
    const tokens = [{ name: 'rowGap', type: 'length', default: '2px', description: 'Space between rows.' }]
    expect(AtomBlockDefinitionMetadataSchema.safeParse({ ...base, tokens }).success).toBe(true)
    expect(blockTokenDescriptors({ definition: { ...base, tokens } })).toEqual(tokens)
  })
  it('refuses an unknown type, a kebab name and a missing default', () => {
    for (const bad of [
      { name: 'rowGap', type: 'size', default: '2px', description: 'x' },
      { name: 'row-gap', type: 'length', default: '2px', description: 'x' },
      { name: 'rowGap', type: 'length', description: 'x' },
    ]) {
      expect(AtomBlockDefinitionMetadataSchema.safeParse({ ...base, tokens: [bad] }).success).toBe(false)
    }
  })
})

describe('mergeThemeBlocks never reaches Object.prototype', () => {
  it('drops a "__proto__" block or token name from parsed JSON', () => {
    const layer = JSON.parse('{"__proto__": {"polluted": "yes"}, "prose": {"__proto__": "x", "codeSurface": "red"}}') as unknown
    const out = mergeThemeBlocks(layer)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(out?.['prose']?.['codeSurface']).toBe('red')
    expect(Object.keys(out ?? {})).toEqual(['prose'])
  })
})
