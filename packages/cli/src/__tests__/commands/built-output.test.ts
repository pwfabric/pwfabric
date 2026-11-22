/**
 * A built pwapp as `pwf check`, `pwf compare` and `pwf shoot` read it
 * (commands/lib/built-output.ts): a folder, an app folder or a .pwapp; its
 * project's routes and per-locale addresses; its redirects.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePwpack } from '@pwfabric/pack'
import { readBuiltOutput, resolveServed } from '../../commands/lib/built-output.js'
import { tempDir } from './helpers.js'

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await tempDir()
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  return dir
}

describe('readBuiltOutput', () => {
  it('says what is missing: the path, an index.html in a folder or an app’s .pwf/out, one in an archive', async () => {
    const dir = await tempDir()
    await expect(readBuiltOutput(join(dir, 'nope'))).rejects.toMatchObject({ code: 'OUTPUT_MISSING' })
    await expect(readBuiltOutput(dir)).rejects.toThrow(/has no index\.html; build the app first/)
    const app = await folder({ 'pwpack.json': '{}' })
    await expect(readBuiltOutput(app)).rejects.toThrow(/\.pwf[\\/]out has no index\.html/)
    const archive = join(dir, 'x.pwapp')
    await writeFile(archive, await writePwpack({ files: new Map([['readme.txt', new TextEncoder().encode('x')]]) }))
    await expect(readBuiltOutput(archive)).rejects.toThrow(/has no index\.html at its root; it is not a built pwapp/)
  })

  it('reads an archive, a base without its slash, and a project that is no object or no JSON', async () => {
    const dir = await tempDir()
    const archive = join(dir, 'x.pwapp')
    const enc = new TextEncoder()
    await writeFile(archive, await writePwpack({ files: new Map([['index.html', enc.encode('<base href="/shop">')], ['pwpack/project.json', enc.encode('[1]')]]) }))
    const out = await readBuiltOutput(archive)
    expect([out.base, out.router, out.routes, out.entry]).toEqual(['/shop/', 'hash', [], undefined])
    const broken = await readBuiltOutput(await folder({ 'index.html': '', 'pwpack/project.json': '{not json' }))
    expect(broken.addresses).toEqual([])
  })

  it('takes the entry and its address in each locale from the address table, past rows that are no table', async () => {
    const project = {
      surfaceOrder: ['menu', 7, 'dish'],
      entrySurfaceId: 'menu',
      addresses: { en: { menu: '', dish: 'dish/' }, de: { menu: 'de/', dish: 'de/gericht/', bad: 3 }, xx: 'not a row' },
    }
    const out = await readBuiltOutput(await folder({ 'index.html': '', '404.html': '', 'pwpack/project.json': JSON.stringify(project) }))
    expect(out.routes).toEqual(['menu', 'dish'])
    expect(out.addresses.sort()).toEqual(['', 'de/', 'de/gericht/', 'dish/'])
    expect(out.entry).toEqual({ key: 'menu', addresses: ['', 'de/'] })
    expect(out.router).toBe('path')
    // No entry named: the first page; no table: the keys.
    const plain = await readBuiltOutput(await folder({ 'index.html': '', 'pwpack/project.json': JSON.stringify({ surfaceOrder: ['home', 'about'] }) }))
    expect([plain.entry, plain.addresses]).toEqual([{ key: 'home', addresses: [''] }, ['', 'about/']])
  })
})

describe('resolveServed', () => {
  it('follows a redirect to a page of the app, under the base or not, and one off-site', async () => {
    const out = await readBuiltOutput(
      await folder({
        'index.html': '<base href="/shop/">',
        'pricing/index.html': '',
        _redirects: '/shop/old/ /shop/pricing/ 301\n/shop/away/ https://example.com/ 302\n/shop/plain/ pricing/ 301\n',
      })
    )
    expect(resolveServed(out, 'old/')).toMatchObject({ file: 'pricing/index.html', redirectedTo: '/shop/pricing/' })
    expect(resolveServed(out, 'away/')).toEqual({ redirectedTo: 'https://example.com/' })
    expect(resolveServed(out, 'plain/').file).toBe('pricing/index.html')
  })
})
