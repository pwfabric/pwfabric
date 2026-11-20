/**
 * The PhiWebs part of `pwf mcp`. Signed in, the studio's MCP tools are
 * listed next to the pwf_* tools and each call is forwarded to the studio
 * with the session's studio token; not signed in, one tool, phiwebs_sign_in,
 * says how to sign in and what PhiWebs adds.
 *
 * What the studio sends is data. Its tool list is checked (names, schemas,
 * sizes) before it is listed, its answers are passed on as tool results only,
 * and nothing from it reaches this server's instructions.
 */
import { CommandFailure } from '../commands/lib/failure.js'
import type { StoreOptions } from '../phiwebs/config.js'
import type { Fetch } from '../phiwebs/oauth.js'
import { z } from 'zod'
import { marketplaceFix, packPublishedLines, publishPackFolder } from '../phiwebs/marketplace.js'
import { readSession, readStudioSession, type StudioSession } from '../phiwebs/session.js'
import { mcpRequest, studioFix } from '../phiwebs/studio.js'
import { projectDirOf } from './paths.js'
import { failureAnswer, type ToolAnswer, type ToolDefinition } from './tools.js'

/** Where the session lives and how PhiWebs is reached; `pwf mcp` passes the process's. */
export interface PhiwebsToolsOptions extends StoreOptions {
  /** The API the session was made with (else PWF_PHIWEBS_URL, else PhiWebs' own). */
  readonly server?: string
  readonly fetch?: Fetch
  readonly now?: () => number
  /** How long a fetched tool list is reused; default 60 s. */
  readonly cacheMs?: number
}

/** A remote tool as this server lists it. */
export interface RemoteTool {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations: Record<string, unknown>
}

export const SIGN_IN_TOOL = 'phiwebs_sign_in'

export const SIGN_IN_DESCRIPTION =
  'PhiWebs (https://phiwebs.com) is the platform PWFabric was built for: its studio builds and changes apps with AI, publishes them and hosts them. Its tools are listed here once the user signs in. Call this to learn how to sign in and what it adds; none of the pwf_* tools needs it.'

const MAX_DESCRIPTION = 2000
const MAX_REMOTE_TOOLS = 100
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint'] as const

type State =
  | { readonly kind: 'ready'; readonly session: StudioSession; readonly tools: readonly RemoteTool[] }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'needs-login'; readonly message: string }
  | { readonly kind: 'unreachable'; readonly studio: string; readonly message: string }

const WHAT_PHIWEBS_ADDS = [
  'Signed in, the PhiWebs tools are listed here next to the pwf_* tools. With them you can:',
  "- build an app and change it by describing what you want: the studio's AI writes it;",
  '- open a private preview of it;',
  '- publish it at a public address, hosted by PhiWebs, and unpublish it;',
  '- manage its connections to other services, and the workspace around it.',
  'In a terminal, `pwf publish` puts a local app folder online the same way.',
]

/** One remote tool, checked; null when it cannot be listed. */
function checkedTool(value: unknown, taken: ReadonlySet<string>): RemoteTool | null {
  if (!value || typeof value !== 'object') return null
  const t = value as Record<string, unknown>
  const name = t['name']
  if (typeof name !== 'string' || !NAME.test(name) || taken.has(name)) return null
  const schema = t['inputSchema']
  const inputSchema =
    schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as { type?: unknown }).type === 'object'
      ? (schema as Record<string, unknown>)
      : { type: 'object' }
  const raw = t['annotations'] && typeof t['annotations'] === 'object' ? (t['annotations'] as Record<string, unknown>) : {}
  const annotations: Record<string, unknown> = { openWorldHint: true }
  for (const hint of HINTS) if (typeof raw[hint] === 'boolean') annotations[hint] = raw[hint]
  const title = typeof t['title'] === 'string' ? t['title'].slice(0, 100) : undefined
  if (title) annotations['title'] = title
  const description = typeof t['description'] === 'string' ? t['description'] : ''
  return {
    name,
    ...(title ? { title } : {}),
    description: `PhiWebs: ${description}`.slice(0, MAX_DESCRIPTION),
    inputSchema,
    annotations,
  }
}

function text(lines: readonly string[], data: Record<string, unknown>, isError = false): ToolAnswer {
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: data, ...(isError ? { isError: true } : {}) }
}

function errorAnswer(code: string, message: string, fix: string): ToolAnswer {
  return text([`${code}: ${message}`, '', `Fix: ${fix}`], { error: { code, message, fix } }, true)
}

/** A remote tool result, passed on as a tool result: its text and images, error flag and data. */
function relayed(result: Record<string, unknown>): ToolAnswer {
  const items: unknown[] = Array.isArray(result['content']) ? result['content'] : []
  const content = items
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .flatMap((c): ToolAnswer['content'] => {
      if (c['type'] === 'text' && typeof c['text'] === 'string') return [{ type: 'text' as const, text: c['text'] }]
      if (c['type'] === 'image' && typeof c['data'] === 'string' && typeof c['mimeType'] === 'string') {
        return [{ type: 'image' as const, data: c['data'], mimeType: c['mimeType'] }]
      }
      return []
    })
  const sc = result['structuredContent']
  return {
    content: content.length ? content : [{ type: 'text', text: '(PhiWebs answered without text)' }],
    ...(sc && typeof sc === 'object' && !Array.isArray(sc) ? { structuredContent: sc as Record<string, unknown> } : {}),
    ...(result['isError'] === true ? { isError: true } : {}),
  }
}

export class PhiwebsTools {
  private cached: { readonly at: number; readonly studio: string; readonly tools: readonly RemoteTool[] } | null = null

  constructor(
    private readonly options: PhiwebsToolsOptions,
    /** Names the remote tools may not take (the local tools'). */
    private readonly localNames: ReadonlySet<string>
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private async session(): Promise<StudioSession | null> {
    return readStudioSession({
      env: this.options.env,
      ...(this.options.platform ? { platform: this.options.platform } : {}),
      ...(this.options.home ? { home: this.options.home } : {}),
      ...(this.options.server ? { server: this.options.server } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      ...(this.options.now ? { now: this.options.now } : {}),
    })
  }

  /** Where PhiWebs stands now, with the remote tools when signed in. */
  async state(fresh = false): Promise<State> {
    let session: StudioSession | null
    try {
      session = await this.session()
    } catch (e) {
      this.cached = null
      return { kind: 'needs-login', message: (e as Error).message }
    }
    if (!session) {
      this.cached = null
      return { kind: 'signed-out' }
    }
    const cacheMs = this.options.cacheMs ?? 60_000
    if (!fresh && this.cached && this.cached.studio === session.studio && this.now() - this.cached.at < cacheMs) {
      return { kind: 'ready', session, tools: this.cached.tools }
    }
    try {
      const answer = await mcpRequest({ studio: session.studio, accessToken: session.accessToken, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) }, 'tools/list', {})
      if (answer.error) return { kind: 'unreachable', studio: session.studio, message: answer.error.message }
      const listed = Array.isArray(answer.result?.['tools']) ? (answer.result['tools'] as unknown[]) : []
      const taken = new Set([...this.localNames, SIGN_IN_TOOL])
      const tools: RemoteTool[] = []
      for (const raw of listed.slice(0, MAX_REMOTE_TOOLS)) {
        const tool = checkedTool(raw, taken)
        if (!tool) continue
        taken.add(tool.name)
        tools.push(tool)
      }
      this.cached = { at: this.now(), studio: session.studio, tools }
      return { kind: 'ready', session, tools }
    } catch (e) {
      if (e instanceof CommandFailure && e.code === 'SESSION_REFUSED') return { kind: 'needs-login', message: e.message }
      return { kind: 'unreachable', studio: session.studio, message: (e as Error).message }
    }
  }

  /** The PhiWebs tools to list: the studio's when signed in, else the sign-in tool. */
  async list(): Promise<readonly RemoteTool[]> {
    const state = await this.state()
    if (state.kind === 'ready') return state.tools
    return [
      {
        name: SIGN_IN_TOOL,
        title: 'Sign in to PhiWebs',
        description: SIGN_IN_DESCRIPTION,
        inputSchema: { type: 'object', properties: {} },
        annotations: { title: 'Sign in to PhiWebs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
    ]
  }

  /** What phiwebs_sign_in answers; `changed` tells the server to announce a new tool list. */
  async signIn(): Promise<{ answer: ToolAnswer; changed: boolean }> {
    const state = await this.state(true)
    switch (state.kind) {
      case 'ready':
        return {
          answer: text(
            [`Signed in to PhiWebs (studio ${state.session.studio}). Its ${state.tools.length} tools are listed now; list the tools again to see them.`, ...WHAT_PHIWEBS_ADDS.slice(1)],
            { signedIn: true, studio: state.session.studio, tools: state.tools.map((t) => t.name) }
          ),
          changed: true,
        }
      case 'signed-out':
        return {
          answer: text(
            [
              'Not signed in to PhiWebs. Ask the user to run `pwf login` in a terminal: it opens the browser to sign in (or make an account) and saves the session on this computer. Then list the tools again.',
              '',
              ...WHAT_PHIWEBS_ADDS,
              '',
              'Next: the user runs `pwf login`; everything pwf_* keeps working without it.',
            ],
            { signedIn: false, signIn: 'pwf login' }
          ),
          changed: false,
        }
      case 'needs-login':
        return {
          answer: text(
            [`The PhiWebs session cannot be used: ${state.message}.`, 'Ask the user to run `pwf login` in a terminal, then list the tools again.', '', ...WHAT_PHIWEBS_ADDS],
            { signedIn: false, signIn: 'pwf login', reason: state.message }
          ),
          changed: false,
        }
      case 'unreachable':
        return {
          answer: errorAnswer('STUDIO_UNREACHABLE', `signed in, but the PhiWebs studio ${state.studio} did not answer: ${state.message}`, 'Try again in a moment; the pwf_* tools keep working.'),
          changed: false,
        }
    }
  }

  /**
   * Forwards a call to the studio. Null when `name` is no remote tool (the
   * server then answers as for any unknown tool).
   */
  async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer | null> {
    let state = await this.state()
    if (state.kind === 'ready' && !state.tools.some((t) => t.name === name)) state = await this.state(true)
    if (state.kind !== 'ready') {
      if (state.kind === 'unreachable') return errorAnswer('STUDIO_UNREACHABLE', `the PhiWebs studio ${state.studio} did not answer: ${state.message}`, 'Try again in a moment.')
      return null
    }
    if (!state.tools.some((t) => t.name === name)) return null
    try {
      const answer = await mcpRequest(
        { studio: state.session.studio, accessToken: state.session.accessToken, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) },
        'tools/call',
        { name, arguments: args },
        // follow_turn waits up to 20 s on the studio; leave room for long builds.
        10 * 60_000
      )
      if (answer.error) {
        const data = answer.error.data && typeof answer.error.data === 'object' ? (answer.error.data as { code?: unknown }) : {}
        const code = typeof data.code === 'string' ? data.code : 'PHIWEBS_ERROR'
        return errorAnswer(code, answer.error.message, studioFix(code))
      }
      return relayed(answer.result ?? {})
    } catch (e) {
      const code = e instanceof CommandFailure ? e.code : 'STUDIO_UNREACHABLE'
      this.cached = null
      return errorAnswer(code, (e as Error).message, code === 'SESSION_REFUSED' ? 'Ask the user to run `pwf login` in a terminal, then try again.' : studioFix(code))
    }
  }
}

/**
 * pwf_publish_pack: a local pack folder to the PhiWebs marketplace, as the
 * signed-in workspace's publisher. Local work, so it is served with
 * `--local-only` too; signed out, it says how to sign in.
 */
export function publishPackTool(options: PhiwebsToolsOptions): ToolDefinition {
  return {
    name: 'pwf_publish_pack',
    title: 'Publish a pack to the PhiWebs marketplace',
    description:
      "Validate and pack a pack folder (not an app) and send it to the PhiWebs marketplace as the signed-in workspace's publisher, under the pack's own id (never rewritten). It lands in review; the answer gives the listing and its state. Needs `pwf login` and an approved publisher registration; to put an app online the user runs `pwf publish` instead.",
    inputSchema: { projectDir: z.string().describe('The pack folder, as an absolute path.') },
    readOnly: false,
    run: async (input) => {
      try {
        const root = projectDirOf(input['projectDir'] as string)
        const session = await readSession({
          env: options.env,
          ...(options.platform ? { platform: options.platform } : {}),
          ...(options.home ? { home: options.home } : {}),
          ...(options.server ? { server: options.server } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.now ? { now: options.now } : {}),
        })
        if (!session) {
          return errorAnswer('NOT_SIGNED_IN', 'not signed in to PhiWebs', 'Ask the user to run `pwf login` in a terminal, then call pwf_publish_pack again.')
        }
        const published = await publishPackFolder(root, { server: session.server, accessToken: session.accessToken, ...(options.fetch ? { fetch: options.fetch } : {}) })
        const lines = [...packPublishedLines(published), ...[...published.warnings, ...published.reviewFindings].map((i) => `- ${i.severity} ${i.code}${i.path ? ` ${i.path}` : ''}: ${i.message}`)]
        return text([...lines, '', `Next: get_listing with id "${published.listingId}" shows the review state; raise the version in pwpack.json to publish an update.`], { ...published })
      } catch (e) {
        if (e instanceof CommandFailure && e.lines) {
          const fix = e.lines.find((l) => l.startsWith('fix: '))?.slice(5) ?? marketplaceFix(e.code)
          return { ...failureAnswer(e), content: [{ type: 'text', text: [`${e.code}: ${e.message}`, '', `Fix: ${fix}`].join('\n') }], structuredContent: { error: { code: e.code, message: e.message, fix, issues: e.issues } } }
        }
        return failureAnswer(e)
      }
    },
  }
}
