import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveCsp, engineHostOrigin, headersFile, originOf, scriptHash, serializeCsp } from '../../dev/csp.js'
import { robotsTxt } from '../../dev/documents.js'
import { headerPatternMatches, parseHeadersFile } from '../../commands/lib/static-server.js'

const base = { importMapText: '{"imports":{}}', receipts: new Map<string, unknown>(), engines: [], media: [] }

describe('content security policy', () => {
  it('hashes the inline import map exactly', () => {
    const digest = createHash('sha256').update('{"imports":{}}').digest('base64')
    expect(scriptHash('{"imports":{}}')).toBe(`'sha256-${digest}'`)
  })

  it('allows only the app itself when it declares nothing that leaves it', () => {
    const csp = deriveCsp(base)
    expect(csp.header).toBe(
      [
        "default-src 'none'",
        `script-src 'self' blob: ${scriptHash('{"imports":{}}')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
    )
    expect(csp.meta).not.toContain('frame-ancestors')
    expect(csp.unresolved).toEqual([])
  })

  it('collects the origins the app declares: data, engines, sign-in, media and webfonts', () => {
    const receipts = new Map<string, unknown>([
      [
        'home',
        {
          blocks: [
            { type: 'image', props: { src: 'https://img.example.com/a.png', href: 'https://elsewhere.example/x' } },
            { type: 'card', props: { ctaHref: 'https://link.example/' }, children: [{ type: 'video', props: { src: 'https://cdn.example.org/v.mp4' } }] },
          ],
          capabilities: [
            {
              capability: 'platform/persistence',
              config: {
                dataSources: [
                  { id: 'a', kind: 'rest', endpoint: 'https://api.example.com/v1/items?x=1' },
                  { id: 'b', kind: 'rest', endpoint: '/relative/path' },
                  { id: 'c', kind: 'rest', endpoint: 'https://{{state.tenant}}.example.net/items' },
                  { id: 'd', kind: 'entity', entityType: 'Thing' },
                ],
              },
            },
          ],
        },
      ],
    ])
    const csp = deriveCsp({
      ...base,
      receipts,
      connections: { connections: [{ name: 'shop', config: { baseUrl: 'shop.example.com/api' } }, { name: 'tenant', config: {} }, { name: 'dev', config: { baseUrl: 'http://localhost:8787' } }] },
      engines: [
        { connection: 'shop', atomId: 'Shop', engine: { host: '{baseUrl}' } },
        { connection: 'tenant', atomId: 'Tenant', engine: { host: '{tenant}.example.org' } },
        { connection: 'dev', atomId: 'Dev', engine: { host: '{baseUrl}' } },
        { connection: 'graph', atomId: 'Graph', moduleUrl: 'engines/Graph.12345678.mjs' },
      ],
      envelopeAuth: { provider: 'password', loginUrl: 'https://session.example.com/app/w/p/login', startUrl: '/_auth/start' },
      authDefinition: { required: false, topology: 'external', issuer: { issuer: 'https://login.example.com/tenant/v2.0', clientId: 'x' } },
      media: [{ url: 'https://media.example.com/hero.webp' }, { url: 'pwpack/media/logo.png' }],
      webfontHref: 'https://fonts.googleapis.com/css2?family=Inter&display=swap',
    })
    expect(csp.directives['connect-src']).toEqual([
      "'self'",
      'http://localhost:8787',
      'https://api.example.com',
      'https://login.example.com',
      'https://session.example.com',
      'https://shop.example.com',
    ])
    expect(csp.directives['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://cdn.example.org', 'https://img.example.com', 'https://media.example.com'])
    expect(csp.directives['frame-src']).toEqual(['https://cdn.example.org', 'https://img.example.com', 'https://media.example.com'])
    expect(csp.directives['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'])
    expect(csp.directives['font-src']).toEqual(["'self'", 'https://fonts.gstatic.com'])
    expect(csp.header).not.toMatch(/elsewhere\.example|link\.example/)
    expect(csp.unresolved.map((u) => [u.source, u.value])).toEqual([
      ['page:home', 'https://{{state.tenant}}.example.net/items'],
      ['connection:tenant', '{tenant}.example.org'],
      ['engine:Graph', 'engines/Graph.12345678.mjs'],
      ['auth', 'https://login.example.com/tenant/v2.0'],
    ])
  })

  it("allows framing the app's own media document, and only that", () => {
    // An embed showing the app's own PDF was refused: there was no frame-src at all.
    const page = (props: Record<string, unknown>): Map<string, unknown> =>
      new Map([['report', { blocks: [{ type: 'container', props: {}, children: [{ type: 'embed', props }] }] }]])
    expect(deriveCsp({ ...base, receipts: page({ src: 'pwpack/media/sprint-25.pdf' }) }).directives['frame-src']).toEqual(["'self'"])
    expect(deriveCsp({ ...base, receipts: page({ src: '/pwpack/media/terms.txt' }) }).directives['frame-src']).toEqual(["'self'"])
    // Same-origin HTML in a frame runs as the app: it never opens frame-src 'self'.
    expect(deriveCsp({ ...base, receipts: page({ src: '/pwpack/media/terms.html' }) }).directives['frame-src']).toBeUndefined()
    expect(deriveCsp({ ...base, receipts: page({ src: 'pwpack/media/terms.htm' }) }).directives['frame-src']).toBeUndefined()
    // An image of its own is not a frame; a link to the PDF is navigation, not a frame.
    expect(deriveCsp({ ...base, receipts: page({ src: 'pwpack/media/logo.svg' }) }).directives['frame-src']).toBeUndefined()
    expect(deriveCsp({ ...base, receipts: page({ href: 'pwpack/media/sprint-25.pdf' }) }).directives['frame-src']).toBeUndefined()
    // Nothing outside the media folder.
    expect(deriveCsp({ ...base, receipts: page({ src: 'pwpack/media/../project.html' }) }).directives['frame-src']).toBeUndefined()
  })

  it('adds the origins a placed block declares to their directives', () => {
    const csp = deriveCsp({
      ...base,
      blocks: [
        { atomId: 'media.interactive-map', origins: { frame: ['https://www.openstreetmap.org'], img: ['https://tile.openstreetmap.org'] } },
        { atomId: 'data.feed', origins: { connect: ['https://api.example.com'], media: ['https://cdn.example.com'], font: ['https://f.example.com'], style: ['https://s.example.com'] } },
        { atomId: 'text.title' },
      ],
    })
    expect(csp.directives['frame-src']).toEqual(['https://www.openstreetmap.org'])
    expect(csp.directives['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'])
    expect(csp.directives['media-src']).toEqual(["'self'", 'data:', 'blob:', 'https://cdn.example.com'])
    expect(csp.directives['connect-src']).toEqual(["'self'", 'https://api.example.com'])
    expect(csp.directives['font-src']).toEqual(["'self'", 'https://f.example.com'])
    expect(csp.directives['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://s.example.com'])
  })

  it('resolves engine hosts the way a reader does: https, except explicit http on loopback', () => {
    expect(engineHostOrigin('{baseUrl}', { baseUrl: 'api.example.com/v1' })).toBe('https://api.example.com')
    expect(engineHostOrigin('http://api.example.com', {})).toBe('https://api.example.com')
    expect(engineHostOrigin('http://127.0.0.1:9000/x', {})).toBe('http://127.0.0.1:9000')
    expect(engineHostOrigin('http://dev.localhost', {})).toBe('http://dev.localhost')
    expect(engineHostOrigin('{missing}.example.com', {})).toBeUndefined()
  })

  it('reads origins of absolute addresses only', () => {
    expect(originOf('https://a.example.com:8443/x?y#z')).toBe('https://a.example.com:8443')
    expect(originOf('/relative')).toBeNull()
    expect(originOf('https://{{x}}.example.com')).toBeUndefined()
  })

  it('writes the header file and leaves header-only directives out of a meta policy', () => {
    const headers = headersFile("default-src 'none'", "default-src 'none'; frame-ancestors 'self'")
    expect(headers.startsWith("/*\n  Content-Security-Policy: default-src 'none'\n")).toBe(true)
    expect(serializeCsp({ 'default-src': ["'none'"], 'frame-ancestors': ["'none'"], sandbox: ['allow-scripts'] }, { meta: true })).toBe(
      "default-src 'none'"
    )
  })

  it("E-1: the app's own media may be framed by the app, the page by nobody — one policy per path", () => {
    const csp = deriveCsp({ importMapText: '{}', receipts: new Map(), engines: [], media: [] })
    expect(csp.header).toContain("frame-ancestors 'none'")
    expect(csp.mediaHeader).toBe(csp.header.replace("frame-ancestors 'none'", "frame-ancestors 'self'"))
    const rules = parseHeadersFile(headersFile(csp.header, csp.mediaHeader))
    // As a static host applies them: every matching rule in order, `! Name` detaching.
    const policiesOf = (path: string): string[] => {
      let values: string[] = []
      for (const r of rules) {
        if (!headerPatternMatches(r.pattern, path)) continue
        for (const [name, value] of r.headers) {
          if (name === '! Content-Security-Policy') values = []
          else if (name === 'Content-Security-Policy') values.push(value)
        }
      }
      return values
    }
    expect(policiesOf('/pwpack/media/print-issue-12.pdf')).toEqual([csp.mediaHeader])
    for (const p of ['/', '/index.html', '/menu', '/pwpack/project.json', '/assets/runner.js']) expect(policiesOf(p), p).toEqual([csp.header])
  })

  it('says how long each part of the folder may be kept, one Cache-Control per path', () => {
    const rules = parseHeadersFile(headersFile("default-src 'none'", "default-src 'none'"))
    // A static host applies every matching rule and joins a header two set,
    // honouring `! Name` (detach) in file order.
    const cacheOf = (path: string): string[] => {
      let values: string[] = []
      for (const r of rules) {
        if (!headerPatternMatches(r.pattern, path)) continue
        for (const [name, value] of r.headers) {
          if (name === '! Cache-Control') values = []
          else if (name === 'Cache-Control') values.push(value)
        }
      }
      return values
    }
    const immutable = ['public, max-age=31536000, immutable']
    expect(cacheOf('/assets/embed.1a2b3c4d.js')).toEqual(immutable)
    expect(cacheOf('/blocks/card.1a2b3c4d.mjs')).toEqual(immutable)
    expect(cacheOf('/engines/Graph.1a2b3c4d.mjs')).toEqual(immutable)
    for (const p of ['/', '/index.html', '/blocks/manifest.json', '/engines/manifest.json', '/shims/react.mjs', '/pwpack/project.json']) {
      expect(cacheOf(p), p).toEqual(['no-cache'])
    }
    expect(cacheOf('/pwpack/media/logo.svg')).toEqual(['public, max-age=3600'])
    expect(robotsTxt()).toBe('User-agent: *\nAllow: /\n')
  })
})
