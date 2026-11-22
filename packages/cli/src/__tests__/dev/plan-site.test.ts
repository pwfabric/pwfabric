import { describe, expect, it } from 'vitest'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import { deriveCsp, headersFile } from '../../dev/csp.js'
import { pathsOverlap, planHeadersOf, planRedirectsOf, planScriptOrigins, planScriptsOf, redirectsFile } from '../../dev/plan-site.js'
import { parseRedirectsFile, redirectFor } from '../../commands/lib/static-server.js'

const check = <T>(read: (plan: unknown, d: AssembleDiagnostic[]) => T, plan: unknown): { value: T; codes: string[]; messages: string[] } => {
  const d: AssembleDiagnostic[] = []
  const value = read(plan, d)
  return { value, codes: d.map((x) => x.code), messages: d.map((x) => x.message) }
}

/** Characters that must never reach a line-and-field file a host reads. */
const UNSAFE = ['\u0000', '\u0085', '\u2028', '\n', ' ']

const script = { key: 'visits', src: 'https://cdn.example.com/tag.js', origins: { connect: ['https://collect.example.com'] }, consent: 'analytics' }

describe('plan scripts', () => {
  it('reads a well-formed script; origins and integrity are optional', () => {
    const r = check(planScriptsOf, { scripts: [{ ...script, integrity: 'sha384-abcd' }, { key: 'chat', src: 'https://chat.example.com:8443/c.js', consent: 'support' }] })
    expect(r.codes).toEqual([])
    expect(r.value).toEqual([{ ...script, integrity: 'sha384-abcd' }, { key: 'chat', src: 'https://chat.example.com:8443/c.js', consent: 'support' }])
  })

  it('reads none when the plan has none', () => {
    expect(check(planScriptsOf, {}).value).toEqual([])
    expect(check(planScriptsOf, undefined).value).toEqual([])
  })

  it.each([
    ['http:', { ...script, src: 'http://cdn.example.com/tag.js' }],
    ['a wildcard host', { ...script, src: 'https://*.example.com/tag.js' }],
    ['a user name and password', { ...script, src: 'https://user:pw@cdn.example.com/tag.js' }],
    ['an explicit default port (the parsed origin is not the written one)', { ...script, src: 'https://cdn.example.com:443/tag.js' }],
    ['an upper-case host', { ...script, src: 'https://CDN.example.com/tag.js' }],
    ['no path', { ...script, src: 'https://cdn.example.com' }],
    ['a wildcard declared origin', { ...script, origins: { script: ['*'] } }],
    ['a declared origin with a path', { ...script, origins: { connect: ['https://collect.example.com/x'] } }],
    ['a directive a script does not take', { ...script, origins: { frame: ['https://cdn.example.com'] } }],
    ['a relative src', { ...script, src: '/tag.js' }],
    ['a javascript: src', { ...script, src: 'javascript:alert(1)' }],
    ['an unknown member', { ...script, defer: true }],
    ['no key', { src: script.src, consent: 'analytics' }],
    ['no consent category', { key: 'visits', src: script.src }],
    ['a consent category that is not a name', { ...script, consent: 'Analytics Cookies' }],
    ['an integrity that is not SRI', { ...script, integrity: 'md5-abc' }],
  ])('refuses %s', (_why, entry) => {
    const r = check(planScriptsOf, { scripts: [entry] })
    expect(r.codes).toEqual(['PLAN_SCRIPT_INVALID'])
    expect(r.value).toEqual([])
  })

  it('refuses a key used twice', () => {
    expect(check(planScriptsOf, { scripts: [script, { ...script, src: 'https://cdn.example.com/b.js' }] }).codes).toEqual(['PLAN_SCRIPT_INVALID'])
  })

  it.each(UNSAFE)('refuses %j in a src or a declared origin', (c) => {
    expect(check(planScriptsOf, { scripts: [{ ...script, src: `https://cdn.example.com/t${c}ag.js` }] }).codes).toEqual(['PLAN_SCRIPT_INVALID'])
    expect(check(planScriptsOf, { scripts: [{ ...script, origins: { connect: [`https://collect.example.com${c}`] } }] }).codes).toEqual(['PLAN_SCRIPT_INVALID'])
  })

  it('names the field it refuses', () => {
    expect(check(planScriptsOf, { scripts: [script, { ...script, key: 'b', src: 'http://x.example.com/a.js' }] }).messages[0]).toMatch(/^scripts\[1\]\.src/)
  })

  it('puts src’s origin and the declared ones in the policy, exact, and nothing for a refused script', () => {
    const scripts = check(planScriptsOf, {
      scripts: [{ ...script, origins: { script: ['https://more.example.com'], connect: ['https://collect.example.com'], img: ['https://pixel.example.com'] } }, { key: 'evil', src: 'https://*.evil.example.com/a.js', consent: 'x' }],
    }).value
    const csp = deriveCsp({ importMapText: '{}', receipts: new Map(), engines: [], media: [], scripts: planScriptOrigins(scripts) })
    expect(csp.directives['script-src']).toEqual(expect.arrayContaining(['https://cdn.example.com', 'https://more.example.com']))
    expect(csp.directives['connect-src']).toContain('https://collect.example.com')
    expect(csp.directives['img-src']).toContain('https://pixel.example.com')
    expect(csp.header).not.toContain('evil')
    expect(csp.header).not.toMatch(/\*/)
  })
})

describe('plan headers', () => {
  it('reads rules and appends them to _headers after the build’s own', () => {
    const r = check(planHeadersOf, { headers: [{ path: '/*', headers: { 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=()' } }] })
    expect(r.codes).toEqual([])
    const file = headersFile("default-src 'none'", "default-src 'none'", ['index.html'], r.value)
    expect(file.endsWith('/*\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=()\n')).toBe(true)
  })

  it.each([
    ['the policy', { 'Content-Security-Policy': "default-src *" }],
    ['the policy in another case', { 'content-security-policy': "default-src *" }],
    ['a take-back of the policy', { '!Content-Security-Policy': 'x' }],
    ['a name that is not a token', { 'X Bad': 'x' }],
    ['an empty value', { 'X-A': '' }],
    ['a value that is not a string', { 'X-A': 1 }],
  ])('refuses %s', (_why, headers) => {
    expect(check(planHeadersOf, { headers: [{ path: '/*', headers }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
  })

  it.each(UNSAFE.filter((c) => c !== ' '))('refuses %j in a header value, name or path', (c) => {
    expect(check(planHeadersOf, { headers: [{ path: '/*', headers: { 'X-A': `a${c}b` } }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
    expect(check(planHeadersOf, { headers: [{ path: '/*', headers: { [`X-A${c}`]: 'a' } }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
    expect(check(planHeadersOf, { headers: [{ path: `/a${c}b`, headers: { 'X-A': 'a' } }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
  })

  it('refuses a header the build sets on a path the rule matches too, and takes it elsewhere', () => {
    const engine = [{ path: '/assets/*', headers: ['Cache-Control'] }, { path: '/*', headers: ['Content-Security-Policy'] }]
    const read = (path: string, name: string) => {
      const d: AssembleDiagnostic[] = []
      planHeadersOf({ headers: [{ path, headers: { [name]: 'x' } }] }, d, engine)
      return d.map((x) => x.code)
    }
    expect(read('/*', 'Cache-Control')).toEqual(['PLAN_HEADER_INVALID'])
    expect(read('/assets/app.js', 'cache-control')).toEqual(['PLAN_HEADER_INVALID'])
    expect(read('/docs/*', 'Cache-Control')).toEqual([])
    expect(read('/*', 'Referrer-Policy')).toEqual([])
    expect(pathsOverlap('/blocks/*.mjs', '/*.json')).toBe(false)
    expect(pathsOverlap('/blocks/*.mjs', '/blocks/*')).toBe(true)
  })

  it('takes a space or a tab inside a value, never in a name or a path', () => {
    expect(check(planHeadersOf, { headers: [{ path: '/*', headers: { 'X-A': 'a b\tc' } }] }).codes).toEqual([])
    expect(check(planHeadersOf, { headers: [{ path: '/*', headers: { 'X A': 'a' } }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
    expect(check(planHeadersOf, { headers: [{ path: '/a b', headers: { 'X-A': 'a' } }] }).codes).toEqual(['PLAN_HEADER_INVALID'])
  })
})

describe('plan redirects', () => {
  it('reads redirects to a path or an address, 301 by default', () => {
    const r = check(planRedirectsOf, { redirects: [{ from: '/old', to: '/new/' }, { from: '/x/*', to: 'https://example.com/:splat', status: 308 }] })
    expect(r.codes).toEqual([])
    expect(redirectsFile(r.value)).toBe('/old /new/ 301\n/x/* https://example.com/:splat 308\n')
  })

  it.each([
    ['a from that is not a path', { from: 'old', to: '/' }],
    ['a protocol-relative target', { from: '/old', to: '//evil.example.com' }],
    ['a javascript: target', { from: '/old', to: 'javascript:alert(1)' }],
    ['a status that is not a redirect', { from: '/old', to: '/', status: 200 }],
    ['a 303', { from: '/old', to: '/', status: 303 }],
    ['a splat inside the path', { from: '/a/*/b', to: '/' }],
    ['a target that is its own from', { from: '/old', to: '/old' }],
  ])('refuses %s', (_why, entry) => {
    expect(check(planRedirectsOf, { redirects: [entry] }).codes).toEqual(['PLAN_REDIRECT_INVALID'])
  })

  it('refuses one from an address the app serves, and writes the rest under the app’s base', () => {
    const d: AssembleDiagnostic[] = []
    const r = planRedirectsOf({ redirects: [{ from: '/menu/', to: '/#/menu' }, { from: '/old', to: '/new/' }] }, d, (p) => p === '/menu/')
    expect(d.map((x) => x.code)).toEqual(['PLAN_REDIRECT_INVALID'])
    expect(redirectsFile(r, '/shop/')).toBe('/shop/old /shop/new/ 301\n')
  })

  it('refuses one from redirected twice', () => {
    expect(check(planRedirectsOf, { redirects: [{ from: '/a', to: '/b' }, { from: '/a', to: '/c' }] }).codes).toEqual(['PLAN_REDIRECT_INVALID'])
  })

  it.each(UNSAFE)('refuses %j in from or to', (c) => {
    expect(check(planRedirectsOf, { redirects: [{ from: `/a${c}b`, to: '/' }] }).codes).toEqual(['PLAN_REDIRECT_INVALID'])
    expect(check(planRedirectsOf, { redirects: [{ from: '/a', to: `/b${c}c` }] }).codes).toEqual(['PLAN_REDIRECT_INVALID'])
    expect(check(planRedirectsOf, { redirects: [{ from: '/a', to: `https://example.com/b${c}` }] }).codes).toEqual(['PLAN_REDIRECT_INVALID'])
  })

  it('is followed by pwf run as a static host follows _redirects', () => {
    const rules = parseRedirectsFile('# comment\n/old /new/ 301\n/blog/* https://blog.example.com/:splat 302\nbroken\n')
    expect(rules).toHaveLength(2)
    expect(redirectFor(rules, '/old')).toEqual({ location: '/new/', status: 301 })
    expect(redirectFor(rules, '/blog/2026/hello')).toEqual({ location: 'https://blog.example.com/2026/hello', status: 302 })
    expect(redirectFor(rules, '/other')).toBeUndefined()
  })
})
