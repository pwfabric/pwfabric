import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { runPublish } from '../../commands/publish.js'
import { guard } from '../../commands/lib/flags.js'
import { parseArgs } from '../../args.js'
import { saveTokens } from '../../phiwebs/config.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

const API = 'https://api.example.test'
const STUDIO = 'https://studio.example.test'

async function setup(signedIn = true): Promise<{ root: string; env: Record<string, string> }> {
  const cwd = await tempDir()
  expect(await main(['create', 'shop', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'shop')
  const env = { APPDATA: join(cwd, 'cfg'), XDG_CONFIG_HOME: join(cwd, 'cfg'), PWF_PHIWEBS_URL: API }
  if (signedIn) {
    await saveTokens(API, { accessToken: 'api-token', clientId: 'c', tokenEndpoint: `${API}/token`, studio: { resource: STUDIO, url: STUDIO, accessToken: 'studio-token', expiresAt: Date.now() + 3_600_000 } }, { env })
  }
  return { root, env }
}

/** A studio that answers the two status routes with `approval` and `published`; it records what it was asked. */
function stub(approval: unknown, published: unknown, seen: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? 'GET'} ${url} ${(init?.headers as Record<string, string>)['authorization']}`)
    const body = url.endsWith('/approval') ? approval : url.endsWith('/published') ? published : { code: 'NOT_FOUND' }
    return new Response(JSON.stringify(body), { status: body === null ? 404 : 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

const status = (root: string, env: Record<string, string>, f: typeof fetch, extra: string[] = []) => {
  const c = capture(root, env)
  return guard('publish', c.io, () => runPublish(parseArgs(['publish', '--status', ...extra]).args, c.io, { fetch: f })).then((code) => ({ code, c }))
}

describe('pwf publish --status', () => {
  it('shows a publish waiting for approval, with the address to approve it', async () => {
    const { root, env } = await setup()
    const seen: string[] = []
    const approval = { request: { action: 'publish', status: 'awaiting', version: 'v3', url: 'https://shop.example.app/', approveUrl: `${STUDIO}/p/shop-1/approve/r1`, expiresAt: '2026-11-23T10:00:00.000Z' }, log: [] }
    const { code, c } = await status(root, env, stub(approval, { published: true, version: 'v2', url: 'https://shop.example.app/' }, seen), ['--project', 'shop-1'])
    expect(code, c.text()).toBe(0)
    expect(c.out).toEqual([
      'Waiting for approval: project shop-1 at v3 is not online yet',
      `  approve  ${STUDIO}/p/shop-1/approve/r1`,
      '  url      https://shop.example.app/ (once approved)',
      '  expires  2026-11-23T10:00:00.000Z',
      '  online meanwhile: v2 at https://shop.example.app/',
    ])
    expect(seen.sort()).toEqual([`GET ${STUDIO}/s/p/shop-1/approval Bearer studio-token`, `GET ${STUDIO}/s/p/shop-1/published Bearer studio-token`])
  })

  it('shows what is online, for the project the folder remembers', async () => {
    const { root, env } = await setup()
    await mkdir(join(root, '.pwf'), { recursive: true })
    await writeFile(join(root, '.pwf', 'phiwebs.json'), JSON.stringify({ projectId: 'shop-2' }))
    const seen: string[] = []
    const { code, c } = await status(root, env, stub({ request: { status: 'approved', approveUrl: `${STUDIO}/x` }, log: [] }, { published: true, version: 'v5', url: 'https://shop.example.app/' }, seen))
    expect(code).toBe(0)
    expect(c.out).toEqual(['Online: project shop-2 at v5', '  url      https://shop.example.app/'])
  })

  it('says not published, also from a studio without the routes, and needs no session for a folder never published', async () => {
    const { root, env } = await setup()
    const { code, c } = await status(root, env, stub(null, null, []), ['--project', 'shop-3', '--json'])
    expect(code).toBe(0)
    expect(JSON.parse(c.out.join('\n'))).toEqual({ projectId: 'shop-3', state: 'none' })
    const never = await setup(false)
    const n = await status(never.root, never.env, stub(null, null, []))
    expect(n.code).toBe(0)
    expect(n.c.out[0]).toMatch(/^Not published from this folder/)
    const out = await status(never.root, never.env, stub(null, null, []), ['--project', 'shop-4'])
    expect(out.code).toBe(1)
    expect(out.c.err.join('\n')).toMatch(/NOT_SIGNED_IN/)
  })
})
