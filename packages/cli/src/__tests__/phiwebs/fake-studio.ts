/**
 * A local server shaped like the PhiWebs studio: project import and publish
 * under /s/, and the stateless MCP endpoint at /mcp. It accepts only tokens
 * the fake API issued for it (`verify`). Listens on 127.0.0.1 only.
 *
 * `split`: two hosts, as PhiWebs runs it — the RESOURCE (`url`) serves only
 * `/mcp`, the web ORIGIN (`webUrl`) only `/s/*`; each answers 404 to the other's
 * routes.
 */
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeStudioRequest {
  /** Which host was asked: the resource or the web origin (the same host unless split). */
  readonly host: 'resource' | 'web'
  readonly method: string
  readonly path: string
  readonly contentType?: string
  readonly bytes: number
}

export interface FakeStudio {
  /** The studio resource (the token audience; `/mcp`). */
  readonly url: string
  /** The studio's web origin (`/s/*`); `url` unless split. */
  readonly webUrl: string
  readonly requests: FakeStudioRequest[]
  /** The bodies the import routes received. */
  readonly imports: Uint8Array[]
  /** JSON-RPC requests /mcp received (method and params). */
  readonly rpc: { method: string; params: Record<string, unknown> }[]
  /** Findings every import answers with. */
  findings: unknown[]
  /** A refusal the next import answers with (once). */
  importRefusal: { status: number; body: unknown } | null
  /** What every publish answers instead of publishing (an approval request, say); null publishes. */
  publishAnswer: { status: number; body: unknown } | null
  /** Projects that answer NOT_OPEN to a publish until opened (a new project starts so). */
  readonly asleep: Set<string>
  /** The tools /mcp lists. */
  tools: unknown[]
  close(): Promise<void>
}

async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export const FAKE_STUDIO_TOOLS = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'Lists the apps (projects) in this workspace.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'start_turn',
    description: 'Starts a build turn.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, message: { type: 'string' } }, required: ['projectId', 'message'] },
  },
  // Not listable: a name that is no tool name, one that takes a local tool's name, a schema that is no object.
  { name: 'bad name!', description: 'x', inputSchema: { type: 'object' } },
  { name: 'pwf_build', description: 'shadows a local tool', inputSchema: { type: 'object' } },
  { name: 'odd_schema', description: 'Its schema is no object.', inputSchema: { type: 'string' }, annotations: { destructiveHint: true, sneaky: 'x' } },
]

export async function startFakeStudio(verify: (token: string) => boolean, options: { split?: boolean } = {}): Promise<FakeStudio> {
  let next = 0
  const projects = new Set<string>()
  const state: FakeStudio = {
    url: '',
    webUrl: '',
    requests: [],
    imports: [],
    rpc: [],
    findings: [],
    importRefusal: null,
    publishAnswer: null,
    asleep: new Set(),
    tools: FAKE_STUDIO_TOOLS,
    close: async () => {
      for (const s of servers) {
        s.closeAllConnections()
        await new Promise<void>((r) => s.close(() => r()))
      }
    },
  }

  const handler = (role: 'both' | 'resource' | 'web') => async (req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://fake-studio.invalid')
    const body = await rawBody(req)
    state.requests.push({
      host: role === 'web' ? 'web' : 'resource',
      method: req.method ?? 'GET',
      path: url.pathname + url.search,
      ...(req.headers['content-type'] ? { contentType: req.headers['content-type'] } : {}),
      bytes: body.length,
    })
    const json = (status: number, value: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(value))
    }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    // A split studio: each host serves its own routes only.
    if ((role === 'resource' && url.pathname !== '/mcp') || (role === 'web' && url.pathname === '/mcp')) {
      return json(404, { error: url.pathname, code: 'NOT_FOUND' })
    }
    if (!verify(bearer)) {
      return json(401, { error: 'sign in', code: 'UNAUTHORIZED' }, { 'www-authenticate': `Bearer resource_metadata="${state.url}/.well-known/oauth-protected-resource"` })
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      const msg = JSON.parse(body.toString('utf8')) as { id: number; method: string; params?: Record<string, unknown> }
      state.rpc.push({ method: msg.method, params: msg.params ?? {} })
      if (msg.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: msg.id, result: { tools: state.tools } })
      if (msg.method === 'tools/call') {
        const name = msg.params?.['name']
        const args = msg.params?.['arguments']
        if (name === 'start_turn' && (args as { projectId?: string })?.projectId === 'busy') {
          return json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: { isError: true, content: [{ type: 'text', text: 'Error PROJECT_BUSY: a turn is running' }], structuredContent: { error: { code: 'PROJECT_BUSY' } } },
          })
        }
        if (name === 'publish') {
          const projectId = (args as { projectId?: string })?.projectId ?? ''
          const pending = { projectId, status: 'awaiting_approval', requestId: 'r-1', approveUrl: `${state.webUrl}/p/${projectId}?approve=r-1`, version: 'abc1234', action: 'publish' }
          return json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: `Waiting for approval: open ${pending.approveUrl}. next: call get_project` }], structuredContent: pending },
          })
        }
        if (name === 'list_projects') {
          return json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: '- Shop (id p-1): asleep, not published\nnext: call get_project' }, { type: 'audio', data: 'x' }],
              structuredContent: { projects: [{ id: 'p-1' }] },
            },
          })
        }
        return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'the studio failed', data: { code: 'UPSTREAM_UNAVAILABLE' } } })
      }
      return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } })
    }

    if (req.method !== 'POST') return json(405, { error: 'POST only', code: 'METHOD_NOT_ALLOWED' })
    if (url.pathname === '/s/projects/import' || /^\/s\/p\/[^/]+\/import$/.test(url.pathname)) {
      state.imports.push(new Uint8Array(body))
      if (state.importRefusal) {
        const r = state.importRefusal
        state.importRefusal = null
        return json(r.status, r.body)
      }
      let id: string
      if (url.pathname === '/s/projects/import') {
        id = `p-${++next}`
        projects.add(id)
        // A new project is asleep until opened.
        state.asleep.add(id)
      } else {
        id = url.pathname.split('/')[3] as string
        if (!projects.has(id)) return json(404, { error: 'no such project', code: 'NOT_FOUND' })
      }
      return json(200, { projectId: id, findings: state.findings })
    }
    const m = /^\/s\/p\/([^/]+)\/(open|publish)$/.exec(url.pathname)
    if (m) {
      const id = m[1] as string
      if (!projects.has(id)) return json(404, { error: 'no such project', code: 'NOT_FOUND' })
      if (m[2] === 'open') {
        state.asleep.delete(id)
        return json(200, { state: 'ready' })
      }
      if (state.asleep.has(id)) return json(409, { error: 'the project is asleep: open it first', code: 'NOT_OPEN' })
      if (state.publishAnswer) return json(state.publishAnswer.status, state.publishAnswer.body)
      return json(200, { app: id, version: 'abc1234', url: `https://${id}.apps.example.com/` })
    }
    json(404, { error: url.pathname, code: 'NOT_FOUND' })
  }
  const listen = async (role: 'both' | 'resource' | 'web'): Promise<string> => {
    const server = createServer((req, res) => void handler(role)(req, res))
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  const servers: import('node:http').Server[] = []
  const resource = await listen(options.split ? 'resource' : 'both')
  ;(state as { url: string }).url = resource
  ;(state as { webUrl: string }).webUrl = options.split ? await listen('web') : resource
  return state
}
