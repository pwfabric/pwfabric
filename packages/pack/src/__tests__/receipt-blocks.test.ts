import { describe, expect, it } from 'vitest'
import type { AtomRef } from '@pwfabric/contracts'
import {
  BLOCK_ID_DUPLICATE,
  blockTypeFirstUses,
  checkBlockIds,
  checkBlockTypes,
  definedBlockTypes,
  packFromRecord,
  UNKNOWN_BLOCK_TYPE,
} from '../index.js'

const page = (key: string, blocks: unknown[]) => ({ key, path: `app/surfaces/${key}.receipt.json`, receipt: { blocks } })

describe('checkBlockIds', () => {
  it('finds an id used twice on one page, nested and as written, naming both paths', () => {
    const issues = checkBlockIds(
      page('home', [
        { id: 'hero', type: 'section', children: [{ id: 'title', type: 'heading' }, { id: 'list', type: 'repeater', repeat: '{{rows}}', children: [{ id: 'row', type: 'text' }] }] },
        { id: 'title', type: 'text' },
        { type: 'text' },
        { type: 'text' },
        { id: '', type: 'text' },
      ])
    )
    expect(issues).toEqual([
      {
        severity: 'error',
        code: BLOCK_ID_DUPLICATE,
        path: 'app/surfaces/home.receipt.json',
        message: expect.stringContaining('block id "title" is used twice on this page, at blocks[0].children[0] and blocks[1]'),
      },
    ])
  })

  it('counts a repeat template once and ids on different pages apart', () => {
    expect(checkBlockIds(page('a', [{ id: 'list', type: 'repeater', repeat: '{{rows}}', children: [{ id: 'row', type: 'text' }] }]))).toEqual([])
    expect([...checkBlockIds(page('a', [{ id: 'x', type: 't' }])), ...checkBlockIds(page('b', [{ id: 'x', type: 't' }]))]).toEqual([])
  })
})

describe('checkBlockTypes', () => {
  it('reports each unknown type once, at the first page that places it, in type order', () => {
    const pages = [page('home', [{ type: 'zeta', children: [{ type: 'text' }] }]), page('about', [{ type: 'alpha' }, { type: 'zeta' }])]
    expect(blockTypeFirstUses(pages).map(([t, p]) => `${t}@${p.key}`)).toEqual(['alpha@about', 'text@home', 'zeta@home'])
    expect(checkBlockTypes(pages, (t) => t === 'text')).toEqual([
      { severity: 'error', code: UNKNOWN_BLOCK_TYPE, path: 'app/surfaces/about.receipt.json', message: 'page "about" places a block of type "alpha", which neither the app nor its pinned packs define' },
      { severity: 'error', code: UNKNOWN_BLOCK_TYPE, path: 'app/surfaces/home.receipt.json', message: 'page "home" places a block of type "zeta", which neither the app nor its pinned packs define' },
    ])
  })

  it('knows every name a block answers to, across the app and its packs', () => {
    const app = packFromRecord({ 'atoms/blocks/text/title/manifest.json': JSON.stringify({ id: 'text.title', name: 'headline' }) })
    const pack = packFromRecord({})
    const ref = (id: string, relPath: string): AtomRef => ({ kind: 'block', id, relPath, contentHash: '' }) as AtomRef
    const names = definedBlockTypes([
      { folder: app, atoms: [ref('text.title', 'atoms/blocks/text/title/component.tsx')] },
      { folder: pack, atoms: [ref('control.button', 'atoms/blocks/control/button/component.tsx'), { kind: 'capability', id: 'x', relPath: 'x', contentHash: '' } as AtomRef] },
    ])
    expect([...names].sort()).toEqual(['button', 'control.button', 'headline', 'text.title', 'title'])
  })
})
