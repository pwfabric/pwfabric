import { describe, expect, it } from 'vitest'
import {
  blockTypesOf,
  buildConnections,
  buildProjectJson,
  deriveNavigation,
  identityOf,
  mergeEnvelopeEntries,
  moduleFileName,
  pageLabel,
  publisherOf,
  type Page,
  isEnvelopeFileName,
} from '../../dev/envelope.js'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import { formatDiagnostic, hasErrors, sortDiagnostics } from '../../dev/diagnostics.js'

const page = (key: string, receipt: Record<string, unknown>): Page => ({
  key,
  path: `app/surfaces/${key}.receipt.json`,
  bytes: new Uint8Array(),
  receipt,
})

describe('blockTypesOf', () => {
  it('walks blocks and nested children, once per type', () => {
    expect(
      blockTypesOf({
        blocks: [
          { type: 'section', children: [{ type: 'heading' }, { type: 'card', children: [{ type: 'heading' }, 'x', null] }] },
          { type: '' },
          [{ type: 'nested-array' }],
        ],
      }).sort()
    ).toEqual(['card', 'heading', 'nested-array', 'section'])
  })
  it('returns nothing for something that is not a receipt', () => {
    expect(blockTypesOf(null)).toEqual([])
    expect(blockTypesOf({ blocks: 'no' })).toEqual([])
  })
})

describe('navigation and project.json', () => {
  const pages = [page('home', { title: 'Welcome', blocks: [] }), page('menu', { title: '  ', blocks: [] })]
  it('derives a navbar from the route table, entry at /', () => {
    expect(deriveNavigation(pages, 'home')).toEqual({
      navbar: { links: [{ label: 'Welcome', href: '/' }, { label: 'menu', href: '/menu' }] },
    })
    expect(pageLabel(pages[1] as Page)).toBe('menu')
  })
  it('writes the route table and the receipt files', () => {
    expect(buildProjectJson({ id: '@pwpack/a/b', title: 'B', entry: 'home', pages })).toEqual({
      schemaVersion: '1.0.0',
      id: '@pwpack/a/b',
      title: 'B',
      entrySurfaceId: 'home',
      surfaceOrder: ['home', 'menu'],
      surfaceReceiptFiles: { home: 'surfaces/home.receipt.json', menu: 'surfaces/menu.receipt.json' },
    })
  })
  it('carries the identity the app declares', () => {
    expect(buildProjectJson({ id: 'x', title: 'X', entry: 'home', pages, auth: { required: true, methods: ['password', 3] } })['identity']).toEqual({
      required: true,
      topology: 'app',
      methods: ['password'],
    })
    expect(identityOf({ topology: 'external', issuer: {} })).toEqual({ required: false, topology: 'external' })
    expect(identityOf('nope')).toBeUndefined()
    // only who may read and write: no door, no wall, so no identity (and no `auth.json` to ask for)
    expect(identityOf({ access: { rules: [{ subject: 'public', model: 'Booking', rule: 'create' }] } })).toBeUndefined()
    expect(identityOf({ required: true })).toEqual({ required: true, topology: 'app', methods: [] })
  })
})

describe('buildConnections', () => {
  it('drops credential-like keys at any depth and says so', () => {
    const diagnostics: AssembleDiagnostic[] = []
    const out = buildConnections(
      {
        connections: [
          'plain',
          { name: 'shop', connector: 'rest', config: { baseUrl: 'a', apiKey: 'k', nested: { Authorization: 'x', ok: 1 }, list: [{ token: 1, n: 2 }] } },
          { connector: 'nameless' },
        ],
      },
      diagnostics
    )
    expect(out).toEqual({
      connections: [{ name: 'plain' }, { name: 'shop', connector: 'rest', config: { baseUrl: 'a', nested: { ok: 1 }, list: [{ n: 2 }] } }],
    })
    expect(diagnostics.map((d) => d.code)).toEqual(['CREDENTIAL_DROPPED', 'CREDENTIAL_DROPPED', 'CREDENTIAL_DROPPED', 'CONNECTION_INVALID'])
  })
  it('is absent when nothing is declared', () => {
    expect(buildConnections(undefined, [])).toBeUndefined()
    expect(buildConnections({}, [])).toEqual({ connections: [] })
  })
})

describe('module names', () => {
  it('names a module by type and hash, replacing unsafe characters', () => {
    expect(moduleFileName('heading', 'abcdef0123456789')).toBe('heading.abcdef01.mjs')
    expect(moduleFileName('@acme/cards.badge', 'ff00ff00ff')).toBe('_acme_cards.badge.ff00ff00.mjs')
    expect(moduleFileName('', '12345678')).toBe('module.12345678.mjs')
    expect(moduleFileName('..x', '12345678')).toBe('_x.12345678.mjs')
  })
  it('attributes an atom to the pack publisher', () => {
    expect(publisherOf('@pwpack/acme/cards')).toBe('acme')
    expect(publisherOf('local-pack')).toBe('local-pack')
  })
})

describe('mergeEnvelopeEntries', () => {
  it('adds files, merges project.json and refuses odd names', () => {
    const enc = new TextEncoder()
    const files = new Map<string, Uint8Array>([['pwpack/project.json', enc.encode(JSON.stringify({ id: 'a', title: 'A' }))]])
    const diagnostics: AssembleDiagnostic[] = []
    mergeEnvelopeEntries(
      files,
      { 'auth.json': { provider: 'password', loginUrl: 'http://h/_host/login' }, 'project.json': { title: 'B' }, '../x.json': {}, 'readme.txt': 'x' },
      diagnostics
    )
    expect(JSON.parse(new TextDecoder().decode(files.get('pwpack/auth.json')))).toEqual({ provider: 'password', loginUrl: 'http://h/_host/login' })
    expect(JSON.parse(new TextDecoder().decode(files.get('pwpack/project.json')))).toEqual({ id: 'a', title: 'B' })
    expect(diagnostics.map((d) => d.code)).toEqual(['HOST_ENTRY_IGNORED', 'HOST_ENTRY_IGNORED'])
    mergeEnvelopeEntries(files, undefined, diagnostics)
    expect(diagnostics).toHaveLength(2)
  })
})

describe('isEnvelopeFileName', () => {
  it('takes envelope-relative JSON paths, receipts included, and nothing that could escape', () => {
    for (const ok of ['auth.json', 'surfaces/home.receipt.json', 'surfaces/my-page_2.receipt.json', 'a/b/c.json']) {
      expect(isEnvelopeFileName(ok)).toBe(true)
    }
    for (const bad of ['../x.json', 'surfaces/../x.json', './x.json', '.hidden.json', '/abs.json', 'a\\b.json', 'x.txt', 'surfaces/', '']) {
      expect(isEnvelopeFileName(bad)).toBe(false)
    }
  })

  it('lets a host receipt replace the static copy', () => {
    const enc = new TextEncoder()
    const files = new Map<string, Uint8Array>([['pwpack/surfaces/home.receipt.json', enc.encode('{"blocks":[]}')]])
    const diagnostics: AssembleDiagnostic[] = []
    mergeEnvelopeEntries(files, { 'surfaces/home.receipt.json': { blocks: [], capabilities: [{ capability: 'x' }] } }, diagnostics)
    expect(diagnostics).toEqual([])
    expect(JSON.parse(new TextDecoder().decode(files.get('pwpack/surfaces/home.receipt.json')))).toEqual({
      blocks: [],
      capabilities: [{ capability: 'x' }],
    })
  })
})

describe('diagnostics', () => {
  it('formats, sorts and detects errors', () => {
    const list: AssembleDiagnostic[] = [
      { severity: 'info', code: 'I', message: 'i' },
      { severity: 'warning', code: 'W', message: 'w', path: 'a.ts', line: 3 },
      { severity: 'error', code: 'E', message: 'e', path: 'b.ts', line: 1, column: 2 },
    ]
    expect(sortDiagnostics(list).map((d) => d.code)).toEqual(['E', 'W', 'I'])
    expect(formatDiagnostic(list[2] as AssembleDiagnostic)).toBe('error   b.ts:1:2  E  e')
    expect(formatDiagnostic(list[1] as AssembleDiagnostic)).toBe('warning a.ts:3  W  w')
    expect(formatDiagnostic(list[0] as AssembleDiagnostic)).toBe('info    I  i')
    expect(hasErrors(list)).toBe(true)
    expect(hasErrors(list.slice(0, 2))).toBe(false)
  })
})
