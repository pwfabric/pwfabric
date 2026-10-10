import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { packFromRecord, writePwpack } from '@pwfabric/pack'
import { main } from '../../index.js'
import { parsePort, runRun, untilSignal, DEFAULT_RUN_PORT } from '../../commands/run.js'
import { contentTypeOf, parseHeadersFile, requestPath, startStaticServer, type StaticServer } from '../../commands/lib/static-server.js'
import { capture, tempDir } from './helpers.js'

async function builtApp(): Promise<string> {
  const dir = await tempDir()
  await mkdir(join(dir, 'assets'), { recursive: true })
  await mkdir(join(dir, 'docs'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(dir, 'assets', 'runner.js'), 'export const runApp = () => {}')
  await writeFile(join(dir, 'docs', 'index.html'), '<p>docs</p>')
  return dir
}

describe('static server', () => {
  it('serves files with their content types, falls back to index.html for pages and 404s missing assets', async () => {
    const dir = await builtApp()
    const server = await startStaticServer({ source: { dir }, port: 0 })
    try {
      const index = await fetch(server.url)
      expect(index.status).toBe(200)
      expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(await index.text()).toContain('id="root"')

      const js = await fetch(new URL('assets/runner.js', server.url))
      expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(await js.text()).toContain('runApp')

      const page = await fetch(new URL('menu/today', server.url))
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('id="root"')

      expect(await (await fetch(new URL('docs', server.url))).text()).toBe('<p>docs</p>')
      expect((await fetch(new URL('assets/missing.js', server.url))).status).toBe(404)
      expect((await fetch(new URL('x%2F..%2F..%2Fsecret.txt', server.url))).status).toBe(404)
      expect((await fetch(new URL('%E0%A4%A', server.url))).status).toBe(404)

      const head = await fetch(new URL('assets/runner.js', server.url), { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-length')).toBe('30')
      expect((await fetch(server.url, { method: 'POST' })).status).toBe(405)
    } finally {
      await server.close()
    }
  })

  it('adds the headers a built app declares in _headers, and does not serve the file', async () => {
    const dir = await builtApp()
    await writeFile(
      join(dir, '_headers'),
      "# the app's policy\n/*\n  Content-Security-Policy: default-src 'none'\n/assets/*\n  Cache-Control-Hint: long\n"
    )
    expect(parseHeadersFile("/*\n  A: 1\n  B: x: y\n/x\n  C: 2\n")).toEqual([
      { pattern: '/*', headers: [['A', '1'], ['B', 'x: y']] },
      { pattern: '/x', headers: [['C', '2']] },
    ])
    const server = await startStaticServer({ source: { dir }, port: 0 })
    try {
      const index = await fetch(server.url)
      expect(index.headers.get('content-security-policy')).toBe("default-src 'none'")
      expect(index.headers.get('cache-control-hint')).toBeNull()
      const page = await fetch(new URL('menu/today', server.url))
      expect(page.headers.get('content-security-policy')).toBe("default-src 'none'")
      const js = await fetch(new URL('assets/runner.js', server.url))
      expect(js.headers.get('cache-control-hint')).toBe('long')
      expect((await fetch(new URL('_headers', server.url))).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('serves files held in memory', async () => {
    const files = new Map([['index.html', new TextEncoder().encode('<p>mem</p>')]])
    const server = await startStaticServer({ source: { files }, port: 0, hostname: '127.0.0.1' })
    try {
      expect(await (await fetch(new URL('any/page', server.url))).text()).toBe('<p>mem</p>')
      expect((await fetch(new URL('x.css', server.url))).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('rejects when the port is taken', async () => {
    const dir = await builtApp()
    const first = await startStaticServer({ source: { dir }, port: 0 })
    try {
      await expect(startStaticServer({ source: { dir }, port: first.port })).rejects.toThrow()
    } finally {
      await first.close()
    }
  })

  it('maps extensions and request paths', () => {
    expect(contentTypeOf('a/b.mjs')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeOf('a.JSON')).toBe('application/json; charset=utf-8')
    expect(contentTypeOf('a.css')).toBe('text/css; charset=utf-8')
    expect(contentTypeOf('a.svg')).toBe('image/svg+xml')
    expect(contentTypeOf('a.bin')).toBe('application/octet-stream')
    expect(requestPath('/a/./b/?q=1#x')).toBe('a/b')
    expect(requestPath('/a/../b')).toBe('b')
    expect(requestPath('/a%2F..%2Fb')).toBeNull()
    expect(requestPath('/a%5Cb')).toBeNull()
    expect(requestPath('/a%00b')).toBeNull()
  })
})

describe('pwf run', () => {
  it('serves a built folder until told to stop', async () => {
    const dir = await builtApp()
    const c = capture(dir)
    let seen: StaticServer | undefined
    const code = await runRun({ positionals: ['.'], flags: { port: '0' } }, c.io, {
      until: async (server) => {
        seen = server
        const res = await fetch(new URL('assets/runner.js', server.url))
        expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      },
    })
    expect(code).toBe(0)
    expect(c.out[0]).toBe(`Serving . at ${seen?.url}`)
  })

  it('serves a .pwapp archive from memory', async () => {
    const dir = await tempDir()
    const file = join(dir, 'app.pwapp')
    await writeFile(file, await writePwpack(packFromRecord({ 'index.html': '<p>packed</p>', 'assets/runner.js': '' })))
    const code = await runRun({ positionals: ['app.pwapp'], flags: { port: '0' } }, capture(dir).io, {
      until: async (server) => {
        expect(await (await fetch(new URL('page', server.url))).text()).toBe('<p>packed</p>')
      },
    })
    expect(code).toBe(0)
  })

  it('stops on SIGINT by default', async () => {
    const dir = await builtApp()
    const c = capture(dir)
    const running = main(['run', '.', '--port', '0'], c.io)
    for (let i = 0; i < 100 && c.out.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
    process.emit('SIGINT')
    expect(await running).toBe(0)
  })

  it('untilSignal resolves on SIGTERM and removes its listeners', async () => {
    const before = process.listenerCount('SIGTERM')
    const waiting = untilSignal()
    process.emit('SIGTERM')
    await waiting
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })

  it('refuses what it cannot serve', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'x.pwapp'), await writePwpack(packFromRecord({ 'a.js': '' })))
    const c = capture(dir)
    expect(await main(['run'], c.io)).toBe(2)
    expect(await main(['run', '.', '--port', 'abc'], c.io)).toBe(2)
    expect(await main(['run', '.', '--port', '70000'], c.io)).toBe(2)
    expect(await main(['run', '.', '--port', '0'], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('has no index.html; build the app first')
    expect(await main(['run', 'x.pwapp', '--port', '0'], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('it is not a built pwapp')
    expect(await main(['run', 'nope', '--port', '0'], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('no such file or folder')
  })

  it('defaults the port', () => {
    expect(parsePort(undefined)).toBe(DEFAULT_RUN_PORT)
    expect(parsePort('0')).toBe(0)
  })
})
