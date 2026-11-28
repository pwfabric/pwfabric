import { describe, expect, it } from 'vitest'
import type { AtomRef } from '@pwfabric/contracts'
import {
  checkThemeBlocks,
  blockTokensCatalog,
  packFromRecord,
  THEME_BLOCK_TOKEN_NO_DARK,
  THEME_BLOCK_TOKEN_TYPE,
  THEME_BLOCK_TOKEN_UNKNOWN,
  THEME_BLOCK_UNKNOWN,
} from '../index.js'

const ref = (id: string, relPath: string): AtomRef => ({ kind: 'block', id, relPath })
const sidebar = {
  id: 'layout.sidebar',
  kind: 'block',
  name: 'sidebar',
  definition: {
    props: [],
    tokens: [
      { name: 'rowGap', type: 'length', default: '2px', description: 'Space between rows.' },
      { name: 'currentInk', type: 'color', default: 'var(--pw-color-text)', description: 'Ink of the page in view.' },
      { name: 'groupWeight', type: 'fontWeight', default: '600', description: 'Weight of a group label.' },
    ],
  },
}
const pack = packFromRecord({ 'atoms/blocks/layout/sidebar/component.tsx': 'x', 'atoms/blocks/layout/sidebar/manifest.json': JSON.stringify(sidebar) })
const sources = (app: ReturnType<typeof packFromRecord>) => [
  { folder: app, atoms: [] as AtomRef[] },
  { folder: pack, atoms: [ref('layout.sidebar', 'atoms/blocks/layout/sidebar/component.tsx')] },
]
const appWith = (appearance: unknown, extra: Record<string, string> = {}) =>
  packFromRecord({ 'app/definitions/appearance.json': JSON.stringify(appearance), ...extra })
const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort()

describe('theme blocks against the manifests', () => {
  it('a catalogue by every name a block answers to', () => {
    const catalog = blockTokensCatalog(sources(appWith({})))
    expect(catalog.get('sidebar')?.map((t) => t.name)).toEqual(['rowGap', 'currentInk', 'groupWeight'])
    expect(catalog.get('layout.sidebar')?.length).toBe(3)
  })

  it('declared tokens of the right type, with a dark value for the colour: nothing to say', () => {
    const app = appWith({ theme: { blocks: { sidebar: { rowGap: '4px', currentInk: '#218379', groupWeight: '400' } } }, darkTheme: { blocks: { sidebar: { currentInk: '#51c8b8' } } } })
    expect(checkThemeBlocks(app, sources(app))).toEqual([])
  })

  it('an unknown block, an unknown token, a wrong type', () => {
    const app = appWith({ theme: { blocks: { sidbar: { rowGap: '4px' }, sidebar: { rowGapp: '4px', groupWeight: 'heavy' } } } })
    const issues = checkThemeBlocks(app, sources(app))
    expect(codes(issues)).toEqual([THEME_BLOCK_TOKEN_TYPE, THEME_BLOCK_TOKEN_UNKNOWN, THEME_BLOCK_UNKNOWN].sort())
    expect(issues.find((i) => i.code === THEME_BLOCK_UNKNOWN)?.message).toMatch(/did you mean "sidebar"/)
    expect(issues.find((i) => i.code === THEME_BLOCK_TOKEN_UNKNOWN)?.message).toMatch(/did you mean "rowGap"/)
    expect(issues.find((i) => i.code === THEME_BLOCK_TOKEN_TYPE)?.message).toMatch(/font weight/)
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  it('a colour set for light only warns, unless the app is light-only', () => {
    const light = { theme: { blocks: { sidebar: { currentInk: '#218379' } } } }
    const app = appWith(light)
    expect(codes(checkThemeBlocks(app, sources(app)))).toEqual([THEME_BLOCK_TOKEN_NO_DARK])
    const followsScheme = appWith({ theme: { blocks: { sidebar: { currentInk: 'var(--pw-color-text-muted)' } } } })
    expect(checkThemeBlocks(followsScheme, sources(followsScheme))).toEqual([])
    const onlyLight = appWith({ ...light, mode: { policy: 'light' } })
    expect(checkThemeBlocks(onlyLight, sources(onlyLight))).toEqual([])
  })

  it("judges the app's own theme atoms too", () => {
    const app = appWith({ use: 'theme-x' }, { 'atoms/appearance/theme-x/manifest.json': JSON.stringify({ id: 'theme-x', theme: { blocks: { sidebar: { nope: '1px' } } } }) })
    const issues = checkThemeBlocks(app, sources(app))
    expect(issues.map((i) => [i.code, i.path])).toEqual([[THEME_BLOCK_TOKEN_UNKNOWN, 'atoms/appearance/theme-x/manifest.json']])
  })
})
