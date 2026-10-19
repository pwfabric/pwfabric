import { request } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalHost } from '../../host/types.js'
import { contentTypeOf, createDevServer, logLines, startDevServer, urlFor } from '../../dev/server.js'
import type { DevServer } from '../../dev/types.js'
import { makeApp } from './helpers.js'

vi.setConfig({ testTimeout: 90_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.reverse()) await c()
  cleanups = []
})

async function app(): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  return a.root
}
function track(server: DevServer): DevServer {
  cleanups.push(() => server.close())
  return server
}

/** Reads Server-Sent Events from `url` until `count` events named `name` arrived. */
function sse(url: string): { next: (name: string) => Promise<string>; close: () => void } {
  const waiting: { name: string; resolve: (data: string) => void }[] = []
  let buffer = ''
  const req = request(url, (res) => {
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      buffer += chunk
      let at: number
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const event = /^event: (.*)$/m.exec(frame)?.[1]
        const data = /^data: (.*)$/m.exec(frame)?.[1] ?? ''
        const i = waiting.findIndex((w) => w.name === event)
        if (i >= 0) waiting.splice(i, 1)[0]?.resolve(data)
      }
    })
  })
  req.on('error', () => undefined)
  req.end()
  return {
    next: (name) => new Promise((resolve) => waiting.push({ name, resolve })),
    close: () => req.destroy(),
  }
}

describe('dev server', () => {
  it('serves the app, rebuilds on change and tells the page to reload', async () => {
    const root = await app()
    const lines: string[] = []
    const server = track(await createDevServer({ root, port: 0, log: (l) => lines.push(l) }, { watch: { debounceMs: 50 } }))
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(lines[0]).toMatch(/^built in \d+ ms — 1 page, 2 block types, 4\/5 atoms compiled/)

    const get = (p: string): Promise<Response> => fetch(new URL(p, server.url))
    const index = await get('/')
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await index.text()
    expect(html).toContain('/_pwf/reload.js')
    expect(await (await get('/_pwf/reload.js')).text()).toContain('/_pwf/events')
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? '{}') as { imports: Record<string, string> }

    const runner = await get('/assets/runner.js')
    expect(runner.status).toBe(200)
    expect(runner.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await runner.text()).toContain('runApp')
    for (const target of new Set(Object.values(map.imports))) {
      const res = await get(target.replace(/^\.\//, '/'))
      expect(res.status, target).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    }
    const manifest = (await (await get('/blocks/manifest.json')).json()) as { moduleUrl: string }[]
    const block = await get(`/${manifest[0]?.moduleUrl}`)
    expect(block.status).toBe(200)
    expect(block.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect((await get('/pwpack/project.json')).headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect((await get('/assets/theme.css')).headers.get('content-type')).toBe('text/css; charset=utf-8')

    // Edit a page: the watcher rebuilds, the page hears `reload`, the envelope changed.
    const events = sse(new URL('/_pwf/events', server.url).href)
    cleanups.push(async () => events.close())
    await new Promise((r) => setTimeout(r, 200))
    const reload = events.next('reload')
    await writeFile(
      join(root, 'app/surfaces/home.receipt.json'),
      JSON.stringify({ title: 'Home', blocks: [{ id: 'hello', type: 'title', props: { text: 'Edited' } }] })
    )
    expect(JSON.parse(await reload)).toEqual({ ok: true })
    const receipt = (await (await get('/pwpack/surfaces/home.receipt.json')).json()) as { blocks: { props: { text: string } }[] }
    expect(receipt.blocks[0]?.props.text).toBe('Edited')
    expect(((await (await get('/blocks/manifest.json')).json()) as unknown[]).length).toBe(1)
  })

  it('shows an overlay while the build has errors, and recovers', async () => {
    const root = await app()
    const lines: string[] = []
    const server = track(await createDevServer({ root, port: 0, log: (l) => lines.push(l) }, { watch: false }))
    await writeFile(join(root, 'app/surfaces/home.receipt.json'), JSON.stringify({ blocks: [{ type: 'missing-block' }] }))
    const failed = await server.rebuild()
    expect(failed.ok).toBe(false)
    expect(failed.diagnostics.some((d) => d.includes('UNKNOWN_BLOCK_TYPE'))).toBe(true)
    expect(lines.some((l) => l.startsWith('build failed'))).toBe(true)
    expect(lines.some((l) => l.includes('UNKNOWN_BLOCK_TYPE'))).toBe(true)

    const page = await fetch(server.url)
    const html = await page.text()
    expect(html).toContain('Build failed')
    expect(html).toContain('missing-block')
    expect(html).toContain('/_pwf/reload.js')
    const status = (await (await fetch(new URL('/_pwf/status', server.url))).json()) as { ok: boolean }
    expect(status.ok).toBe(false)
    // Deep links get the overlay too; assets keep serving.
    expect(await (await fetch(new URL('/some/page', server.url))).text()).toContain('Build failed')
    expect((await fetch(new URL('/assets/runner.js', server.url))).status).toBe(200)

    await writeFile(join(root, 'app/surfaces/home.receipt.json'), JSON.stringify({ blocks: [{ type: 'title' }] }))
    expect((await server.rebuild()).ok).toBe(true)
    expect(await (await fetch(server.url)).text()).toContain('./assets/boot.js')
  })

  it('answers 404, 400, 405, HEAD and the SPA fallback', async () => {
    const root = await app()
    const server = track(await startDevServer({ root, port: 0, localHost: false }))
    await server.close()
    const live = track(await createDevServer({ root, port: 0 }, { watch: false }))
    const at = (p: string, init?: RequestInit): Promise<Response> => fetch(new URL(p, live.url), init)
    expect((await at('/nope.js')).status).toBe(404)
    expect((await at('/_headers')).status).toBe(404)
    expect((await at('/%E0%A4%A')).status).toBe(400)
    expect((await at('/..%2Fsecret')).status).toBe(400)
    expect((await at('/', { method: 'POST' })).status).toBe(405)
    const head = await at('/assets/runner.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(1000)
    expect(await head.text()).toBe('')
    const deep = await at('/about')
    expect(deep.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await deep.text()).toContain('./assets/boot.js')
  })

  it('mounts a local host: forwards its requests and carries its envelope entries', async () => {
    const root = await app()
    const seen: string[] = []
    const host: LocalHost = {
      envelopeEntries: (origin) => ({ 'auth.json': { provider: 'password', loginUrl: `${origin}/_host/login` } }),
      handle: async (req, res) => {
        seen.push(req.url ?? '')
        if (!req.url?.startsWith('/_host/')) return false
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"host":true}')
        return true
      },
      reset: () => undefined,
    }
    const server = track(await createDevServer({ root, port: 0, localHost: host }, { watch: false }))
    expect(await (await fetch(new URL('/_host/session', server.url))).json()).toEqual({ host: true })
    const auth = (await (await fetch(new URL('/pwpack/auth.json', server.url))).json()) as { loginUrl: string }
    expect(auth.loginUrl).toBe('/_host/login')
    expect(seen).toContain('/_host/session')
  })


  it('creates a host when the app declares one and a factory is given, and notes when none is', async () => {
    const root = await app()
    await writeFile(join(root, 'app/definitions/auth.json'), JSON.stringify({ required: true, methods: ['password'] }))
    await writeFile(join(root, 'app/definitions/entities.json'), JSON.stringify({ entities: [{ typeId: 'Note', fields: [] }] }))
    const lines: string[] = []
    track(await createDevServer({ root, port: 0, log: (l) => lines.push(l) }, { watch: false }))
    expect(lines[0]).toContain('declares sign-in and records, but no local host is mounted')

    const made: { root: string; prefix: string }[] = []
    const server = track(
      await createDevServer(
        { root, port: 0, localHost: true },
        {
          watch: false,
          createHost: (o) => {
            made.push({ root: o.root, prefix: o.prefix })
            return { envelopeEntries: () => ({}), handle: async () => false, reset: () => undefined }
          },
        }
      )
    )
    expect(made).toEqual([{ root, prefix: '/_host' }])
    const project = (await (await fetch(new URL('/pwpack/project.json', server.url))).json()) as { identity: unknown }
    expect(project.identity).toEqual({ required: true, topology: 'app', methods: ['password'] })
  })

  it('mounts the host on a later build when the app gains its first entity while running', async () => {
    const root = await app()
    const made: string[] = []
    const lines: string[] = []
    const server = track(
      await createDevServer(
        { root, port: 0, log: (l) => lines.push(l) },
        {
          watch: false,
          createHost: (o) => {
            made.push(o.prefix)
            return {
              envelopeEntries: () => ({}),
              handle: async (req, res) => {
                if (!req.url?.startsWith('/_host/')) return false
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end('{"host":true}')
                return true
              },
              reset: () => undefined,
            }
          },
        }
      )
    )
    // A bare page needs no host.
    expect(made).toEqual([])
    // No host: the path falls through to the page (SPA fallback), not a records answer.
    expect((await fetch(new URL('/_host/records/Note', server.url))).headers.get('content-type')).toContain('text/html')

    await writeFile(join(root, 'app/definitions/entities.json'), JSON.stringify({ entities: [{ typeId: 'Note', fields: [] }] }))
    await server.rebuild()
    expect(made).toEqual(['/_host'])
    expect(await (await fetch(new URL('/_host/records/Note', server.url))).json()).toEqual({ host: true })
    expect(lines.some((l) => l.startsWith('local host mounted at'))).toBe(true)
    await server.rebuild()
    expect(made).toEqual(['/_host'])
  })

  it('refuses a port that is taken', async () => {
    const root = await app()
    const first = track(await createDevServer({ root, port: 0 }, { watch: false }))
    const port = Number(new URL(first.url).port)
    await expect(createDevServer({ root, port }, { watch: false })).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })

  it('reports a build that throws as an internal error', async () => {
    const root = await app()
    const server = track(
      await createDevServer({ root, port: 0 }, { watch: false, assemble: { runtime: { get runnerJs(): string { throw new Error('boom') }, embedJs: '' } } })
    )
    const r = await server.rebuild()
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0]).toContain('INTERNAL')
  })
})

describe('server helpers', () => {
  it('maps content types and addresses', () => {
    expect(contentTypeOf('a/b.mjs')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeOf('x.WEBP')).toBe('image/webp')
    expect(contentTypeOf('x.bin')).toBe('application/octet-stream')
    expect(urlFor('127.0.0.1', 1)).toBe('http://127.0.0.1:1/')
    expect(urlFor('0.0.0.0', 2)).toBe('http://localhost:2/')
    expect(urlFor('::1', 3)).toBe('http://[::1]:3/')
  })
  it('prints the app findings and counts what pinned packs say', () => {
    expect(
      logLines([
        { severity: 'error', code: 'E', message: 'm', path: '.pwf/packs/x/a.ts' },
        { severity: 'warning', code: 'W', message: 'w', path: '.pwf/packs/x/b.ts' },
        { severity: 'warning', code: 'W2', message: 'w', path: '.pwf/packs/x/c.ts' },
        { severity: 'info', code: 'I', message: 'i' },
        { severity: 'warning', code: 'A', message: 'a', path: 'app/x.json' },
      ])
    ).toEqual([
      'error   .pwf/packs/x/a.ts  E  m',
      'warning app/x.json  A  a',
      '2 findings in pinned packs (`pwf build` lists them)',
    ])
    expect(logLines([{ severity: 'info', code: 'X', message: 'x', path: '.pwf/packs/q' }])).toEqual([
      '1 finding in pinned packs (`pwf build` lists them)',
    ])
  })
})
