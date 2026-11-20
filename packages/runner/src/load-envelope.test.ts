/**
 * The runner asks for `auth.json` only when `project.json` declares an
 * identity. The envelope carries the file only when the app has a way in, so
 * an app without sign-in used to cost a 404 on every boot.
 */
import { describe, expect, it } from 'vitest'
import { loadEnvelope, wantsAuthJson, type JsonFetcher } from './load-envelope.js'

const AT = { documentBase: 'https://app.example/', source: './pwpack', blocksBase: './blocks', enginesBase: './engines' }

/** A fetcher over a fixed set of files; a missing file rejects as a 404 does. */
function served(files: Record<string, unknown>): { fetchJson: JsonFetcher; asked: string[] } {
  const asked: string[] = []
  const fetchJson = (async (url: string) => {
    asked.push(url)
    if (!(url in files)) throw new Error(`${url} → 404`)
    return files[url]
  }) as JsonFetcher
  return { fetchJson, asked }
}

const project = { surfaceOrder: ['home'], entrySurfaceId: 'home' }
const base = { './blocks/manifest.json': [] }

describe('loadEnvelope', () => {
  it('does not request auth.json when the identity has no door (a build no host serves)', async () => {
    const identity = { required: true, topology: 'external', methods: [], door: false }
    const { fetchJson, asked } = served({ ...base, './pwpack/project.json': { ...project, identity } })
    const env = await loadEnvelope(AT, fetchJson)
    expect(asked).not.toContain('./pwpack/auth.json')
    expect(env.auth).toBeNull()
    expect(env.project.identity?.required).toBe(true)
    expect(wantsAuthJson({ identity })).toBe(false)
  })

  it('does not request auth.json when project.json declares no identity', async () => {
    const { fetchJson, asked } = served({ ...base, './pwpack/project.json': project })
    const env = await loadEnvelope(AT, fetchJson)
    expect(asked).not.toContain('./pwpack/auth.json')
    expect(env.auth).toBeNull()
    expect(env.project).toEqual(project)
  })

  it('requests auth.json when project.json declares an identity', async () => {
    const auth = { provider: 'password', loginUrl: 'https://api.example.com/app/login' }
    const identity = { required: false, topology: 'app', methods: ['password'] }
    const { fetchJson, asked } = served({
      ...base,
      './pwpack/project.json': { ...project, identity },
      './pwpack/auth.json': auth,
    })
    const env = await loadEnvelope(AT, fetchJson)
    expect(asked).toContain('./pwpack/auth.json')
    expect(env.auth).toEqual(auth)
  })

  it('reads a declared identity with no auth.json (a required app with no way in) as no door', async () => {
    const { fetchJson, asked } = served({
      ...base,
      './pwpack/project.json': { ...project, identity: { required: true, topology: 'app', methods: [] } },
    })
    const env = await loadEnvelope(AT, fetchJson)
    expect(asked).toContain('./pwpack/auth.json')
    expect(env.auth).toBeNull()
  })

  it('still fails when project.json or the block manifest is missing', async () => {
    await expect(loadEnvelope(AT, served({ ...base }).fetchJson)).rejects.toThrow(/project\.json/)
    await expect(loadEnvelope(AT, served({ './pwpack/project.json': project }).fetchJson)).rejects.toThrow(
      /manifest\.json/
    )
  })

  it('reads the optional files as null when absent', async () => {
    const env = await loadEnvelope(AT, served({ ...base, './pwpack/project.json': project }).fetchJson)
    expect(env).toMatchObject({ navigation: null, appearance: null, connections: null, engineManifest: null })
  })
})

describe('wantsAuthJson', () => {
  it('is true exactly when an identity is declared', () => {
    expect(wantsAuthJson({})).toBe(false)
    expect(wantsAuthJson({ identity: { required: false } })).toBe(true)
  })
})

describe('loadEnvelope with a publish version', () => {
  it('asks for every envelope file under the source as ?v=<version>, and nothing outside it', async () => {
    const identity = { required: false, topology: 'app', methods: ['password'] }
    const { fetchJson, asked } = served({
      ...base,
      './pwpack/project.json?v=7': { ...project, identity },
      './pwpack/auth.json?v=7': { provider: 'password', loginUrl: '/login' },
      './pwpack/navigation.json?v=7': { items: [] },
    })
    const env = await loadEnvelope({ ...AT, version: 7 }, fetchJson)
    expect(env.project.identity).toEqual(identity)
    expect(env.auth).toEqual({ provider: 'password', loginUrl: '/login' })
    expect(asked.filter((u) => u.startsWith('./pwpack/')).sort()).toEqual([
      './pwpack/appearance.json?v=7',
      './pwpack/auth.json?v=7',
      './pwpack/connections.json?v=7',
      './pwpack/navigation.json?v=7',
      './pwpack/project.json?v=7',
    ])
    expect(asked).toContain('./blocks/manifest.json')
  })

  it('keeps the addresses unversioned without one', async () => {
    const { fetchJson, asked } = served({ ...base, './pwpack/project.json': project })
    await loadEnvelope({ ...AT, version: undefined }, fetchJson)
    expect(asked.every((u) => !u.includes('?'))).toBe(true)
  })
})

describe('loadEnvelope: module URLs resolve against the app folder, not the page', () => {
  const blocks = [{ blockType: 'text', moduleUrl: 'blocks/text.1a2b3c4d.mjs', integrity: 'x' }]
  const engines = [
    { connection: 'graph', atomId: 'Graph', kind: 'connector', moduleUrl: 'engines/Graph.1a2b3c4d.mjs', integrity: 'y' },
    { connection: 'decl', atomId: 'Decl', kind: 'connector', engine: { kind: 'rest' } },
  ]
  const files = (prefix: string): Record<string, unknown> => ({
    './pwpack/project.json': project,
    [`${prefix}blocks/manifest.json`]: blocks,
    [`${prefix}engines/manifest.json`]: engines,
  })

  it('standard layout (the shell in the app folder): the same address the page would resolve', async () => {
    for (const documentBase of ['https://app.example/', 'https://app.example/index.html', 'https://host.example/apps/menu/']) {
      const env = await loadEnvelope({ ...AT, documentBase }, served(files('./')).fetchJson)
      expect(env.blockManifest[0]?.moduleUrl).toBe(new URL('blocks/text.1a2b3c4d.mjs', documentBase).href)
      expect(env.engineManifest?.[0]?.moduleUrl).toBe(new URL('engines/Graph.1a2b3c4d.mjs', documentBase).href)
    }
  })

  it('a page at another path than the app files: the modules resolve to the files', async () => {
    const at = {
      documentBase: 'https://host.example/sites/team/pages/home.aspx',
      source: '/assets/menu/pwpack',
      blocksBase: '/assets/menu/blocks',
      enginesBase: '/assets/menu/engines',
    }
    const env = await loadEnvelope(at, served({ ...files('/assets/menu/'), '/assets/menu/pwpack/project.json': project }).fetchJson)
    expect(env.blockManifest[0]?.moduleUrl).toBe('https://host.example/assets/menu/blocks/text.1a2b3c4d.mjs')
    expect(env.engineManifest?.[0]?.moduleUrl).toBe('https://host.example/assets/menu/engines/Graph.1a2b3c4d.mjs')
  })

  it('app files on another origin (a CDN): the modules resolve there', async () => {
    const at = {
      documentBase: 'https://host.example/page',
      source: 'https://cdn.example/apps/menu/pwpack',
      blocksBase: 'https://cdn.example/apps/menu/blocks',
      enginesBase: 'https://cdn.example/apps/menu/engines',
    }
    const env = await loadEnvelope(
      at,
      served({ ...files('https://cdn.example/apps/menu/'), 'https://cdn.example/apps/menu/pwpack/project.json': project }).fetchJson
    )
    expect(env.blockManifest[0]?.moduleUrl).toBe('https://cdn.example/apps/menu/blocks/text.1a2b3c4d.mjs')
    expect(env.engineManifest?.[0]?.moduleUrl).toBe('https://cdn.example/apps/menu/engines/Graph.1a2b3c4d.mjs')
  })

  it('keeps a declared engine (no module) as it is, and an absolute moduleUrl unchanged', async () => {
    const abs = [{ blockType: 'x', moduleUrl: 'https://cdn.example/x.mjs', integrity: 'z' }]
    const env = await loadEnvelope(AT, served({ ...files('./'), './blocks/manifest.json': abs }).fetchJson)
    expect(env.blockManifest[0]?.moduleUrl).toBe('https://cdn.example/x.mjs')
    expect(env.engineManifest?.[1]).toEqual(engines[1])
  })
})
