import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveCsp, engineHostOrigin, headersFile, originOf, scriptHash, serializeCsp } from '../../dev/csp.js'

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
    expect(headersFile("default-src 'none'")).toBe("/*\n  Content-Security-Policy: default-src 'none'\n")
    expect(serializeCsp({ 'default-src': ["'none'"], 'frame-ancestors': ["'none'"], sandbox: ['allow-scripts'] }, { meta: true })).toBe(
      "default-src 'none'"
    )
  })
})
