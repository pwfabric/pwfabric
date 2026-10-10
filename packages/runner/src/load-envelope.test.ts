/**
 * The runner asks for `auth.json` only when `project.json` declares an
 * identity. The envelope carries the file only when the app has a way in, so
 * an app without sign-in used to cost a 404 on every boot.
 */
import { describe, expect, it } from 'vitest'
import { loadEnvelope, wantsAuthJson, type JsonFetcher } from './load-envelope.js'

const AT = { source: './pwpack', blocksBase: './blocks', enginesBase: './engines' }

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
