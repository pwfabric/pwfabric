/**
 * What a build writes besides the pages: the app's icon, its own scripts and
 * the consent loader that adds them, the plan's response headers and
 * redirects, the `public/` folder, and pages in folders of `app/surfaces/`.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp } from '../../dev/assemble.js'
import { makeApp, parse, text } from './helpers.js'

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})
async function app(): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  return a.root
}
const codes = (r: { diagnostics: readonly { code: string }[] }): string[] => r.diagnostics.map((d) => d.code)
const errors = (r: { diagnostics: readonly { code: string; severity: string; message: string }[] }) => r.diagnostics.filter((d) => d.severity === 'error')

async function editJson(root: string, rel: string, change: (doc: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const path = join(root, ...rel.split('/'))
  const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, JSON.stringify(change(doc)))
}
async function put(root: string, rel: string, body: string | Uint8Array): Promise<void> {
  const path = join(root, ...rel.split('/'))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
}
const cspOf = (r: { files: Map<string, Uint8Array> }): string =>
  (parse(r.files.get('publish.json')) as { csp: { policy: string } }).csp.policy
const directive = (policy: string, name: string): string[] =>
  (policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '').split(' ').slice(1)

describe('the app icon (appearance brand.favicon)', () => {
  it('links a public file at the app root', async () => {
    const root = await app()
    await put(root, 'public/favicon.ico', new Uint8Array([0, 0, 1, 0]))
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, brand: { favicon: 'favicon.ico' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('index.html'))).toContain('<link rel="icon" href="./favicon.ico" />')
    expect(r.files.has('favicon.ico')).toBe(true)
  })

  it('links an app file as served and keeps it under img-src self', async () => {
    const root = await app()
    await put(root, 'media/icon.png', new Uint8Array([137, 80, 78, 71]))
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, brand: { favicon: 'media/icon.png' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('index.html'))).toContain('<link rel="icon" href="./pwpack/media/icon.png" />')
    expect(r.files.has('pwpack/media/icon.png')).toBe(true)
  })

  it('links an absolute address and adds its origin to img-src', async () => {
    const root = await app()
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, brand: { favicon: 'https://cdn.example.com/icon.svg' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('index.html'))).toContain('<link rel="icon" href="https://cdn.example.com/icon.svg" />')
    expect(directive(cspOf(r), 'img-src')).toContain('https://cdn.example.com')
  })

  it('refuses an http address (mixed content on an https page) and opens no origin for it', async () => {
    const root = await app()
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, brand: { favicon: 'http://cdn.example.com/icon.svg' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('FAVICON_INVALID')
    expect(text(r.files.get('index.html'))).toContain('<link rel="icon" href="data:," />')
    expect(cspOf(r)).not.toContain('cdn.example.com')
  })

  it('refuses a file the app does not have, and keeps the empty icon without one', async () => {
    const root = await app()
    const plain = await assemblePwapp(root, { cacheDir: null })
    expect(text(plain.files.get('index.html'))).toContain('<link rel="icon" href="data:," />')
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, brand: { favicon: 'media/missing.png' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('FAVICON_INVALID')
  })
})

describe('the plan scripts', () => {
  const script = { key: 'visits', src: 'https://cdn.example.com/tag.js', origins: { connect: ['https://collect.example.com'] }, consent: 'analytics' }

  it('carries them into project.json for the runner and their origins into the policy; no document names them', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, scripts: [script] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect((parse(r.files.get('pwpack/project.json')) as { scripts: unknown }).scripts).toEqual([script])
    expect(text(r.files.get('index.html'))).not.toContain('cdn.example.com/tag.js')
    const policy = cspOf(r)
    expect(directive(policy, 'script-src')).toContain('https://cdn.example.com')
    expect(directive(policy, 'connect-src')).toContain('https://collect.example.com')
    expect(policy).not.toMatch(/\*/)
  })

  it('fails the build on a script it cannot trust, and opens no origin for it', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, scripts: [{ ...script, src: 'http://cdn.example.com/tag.js' }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('PLAN_SCRIPT_INVALID')
    expect(cspOf(r)).not.toContain('cdn.example.com')
  })
})

describe('the plan headers and redirects', () => {
  it('appends the plan headers to _headers, after the policy', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, headers: [{ path: '/*', headers: { 'Permissions-Policy': 'camera=()' } }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const headers = text(r.files.get('_headers'))
    expect(headers).toContain('/*\n  Permissions-Policy: camera=()\n')
    expect(headers.indexOf('Permissions-Policy')).toBeGreaterThan(headers.indexOf('Content-Security-Policy'))
    expect((parse(r.files.get('publish.json')) as { headers: unknown }).headers).toEqual([{ path: '/*', headers: { 'Permissions-Policy': 'camera=()' } }])
  })

  it('refuses a plan header that would replace the policy', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, headers: [{ path: '/*', headers: { 'Content-Security-Policy': "default-src *" } }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('PLAN_HEADER_INVALID')
  })

  it('writes _redirects for the plan redirects, and none without', async () => {
    const root = await app()
    expect((await assemblePwapp(root, { cacheDir: null })).files.has('_redirects')).toBe(false)
    await editJson(root, 'app/plan.json', (d) => ({
      ...d,
      redirects: [{ from: '/old', to: '/' }, { from: '/blog/*', to: 'https://blog.example.com/:splat', status: 302 }],
    }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('_redirects'))).toBe('/old / 301\n/blog/* https://blog.example.com/:splat 302\n')
    expect((parse(r.files.get('publish.json')) as { redirects: unknown }).redirects).toEqual([
      { from: '/old', to: '/', status: 301 },
      { from: '/blog/*', to: 'https://blog.example.com/:splat', status: 302 },
    ])
  })

  it('refuses a redirect from an address the app serves', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, redirects: [{ from: '/robots.txt', to: '/x' }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('PLAN_REDIRECT_INVALID')
  })

  it('refuses a plan header the build sets on the same paths', async () => {
    const root = await app()
    await editJson(root, 'app/plan.json', (d) => ({ ...d, headers: [{ path: '/*', headers: { 'Cache-Control': 'no-store' } }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('PLAN_HEADER_INVALID')
  })
})

describe('the public folder', () => {
  it('is copied verbatim to the root of the served folder', async () => {
    const root = await app()
    await put(root, 'public/google123.html', 'google-site-verification: google123.html')
    await put(root, 'public/.well-known/security.txt', 'Contact: mailto:security@example.com\n')
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('google123.html'))).toBe('google-site-verification: google123.html')
    expect(r.files.has('.well-known/security.txt')).toBe(true)
    expect(r.files.has('public/google123.html')).toBe(false)
    expect(codes(r)).not.toContain('UNKNOWN_TOP_LEVEL')
    expect((parse(r.files.get('pwpack/project.json')) as { publicFiles: string[] }).publicFiles).toEqual(['.well-known/security.txt', 'google123.html'])
  })

  it('may not replace a file the build writes or land in its folders', async () => {
    for (const rel of ['public/robots.txt', 'public/index.html', 'public/_headers', 'public/_redirects', 'public/pwpack/x.json', 'public/assets/a.css', 'public/publish.json']) {
      const root = await app()
      await put(root, rel, 'x')
      const r = await assemblePwapp(root, { cacheDir: null })
      expect(errors(r).map((d) => d.code), rel).toContain('APP_PUBLIC_RESERVED')
      expect(text(r.files.get(rel.slice('public/'.length)))).not.toBe('x')
    }
  })

  it('may not carry script', async () => {
    const root = await app()
    await put(root, 'public/widget.js', 'alert(1)')
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(errors(r).map((d) => d.code)).toContain('APP_PUBLIC_SCRIPT')
    expect(r.files.has('widget.js')).toBe(false)
  })
})

describe('a page in a folder of app/surfaces/', () => {
  async function nested(): Promise<string> {
    const root = await app()
    const home = await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8')
    await put(root, 'app/surfaces/docs/intro.receipt.json', home)
    await editJson(root, 'pwpack.json', (d) => ({ ...d, app: { entry: 'home', surfaceOrder: ['home', 'docs/intro'] } }))
    return root
  }

  it('is page docs/intro: served, routed and given its own document under path routing', async () => {
    const root = await nested()
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(codes(r)).not.toContain('APP_UNEXPECTED_FILE')
    expect(codes(r)).not.toContain('APP_SURFACE_NOT_SERVED')
    expect(r.files.has('pwpack/surfaces/docs/intro.receipt.json')).toBe(true)
    expect(r.files.has('docs/intro/index.html')).toBe(true)
    expect((parse(r.files.get('pwpack/project.json')) as { surfaceOrder: string[] }).surfaceOrder).toEqual(['home', 'docs/intro'])
  })

  it('cannot sit in a folder the build serves its own files from', async () => {
    const root = await app()
    const home = await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8')
    await put(root, 'app/surfaces/assets/intro.receipt.json', home)
    await editJson(root, 'pwpack.json', (d) => ({ ...d, app: { entry: 'home', surfaceOrder: ['home', 'assets/intro'] } }))
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(errors(r).map((d) => d.code)).toContain('PAGE_KEY_RESERVED')
  })
})

describe('the colour-scheme script (appearance §4.1)', () => {
  const scriptOf = (html: string): string | undefined => /<script>(try\{var s=localStorage\.getItem\("pwapp_color_scheme:[^<]*)<\/script>/.exec(html)?.[1]

  it('applies a stored choice before the theme stylesheet, allowed by its hash', async () => {
    const root = await app()
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const html = text(r.files.get('index.html'))
    const script = scriptOf(html)
    expect(script).toContain('"pwapp_color_scheme:@pwpack/k/demo"')
    expect(html.indexOf(script as string)).toBeLessThan(html.indexOf('rel="stylesheet" href="./assets/theme.'))
    const hash = `'sha256-${createHash('sha256').update(script as string).digest('base64')}'`
    expect(directive(cspOf(r), 'script-src')).toContain(hash)
  })

  it('is left out when the app and every page wear light or dark only', async () => {
    const root = await app()
    await editJson(root, 'app/definitions/appearance.json', (d) => ({ ...d, mode: { policy: 'light' } }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(scriptOf(text(r.files.get('index.html')))).toBeUndefined()
  })
})
