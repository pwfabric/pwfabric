/**
 * A built pwapp folder as `pwf check` and `pwf compare` read it: its files,
 * its page documents, how it routes, its routes and per-locale addresses
 * (`pwpack/project.json`), and its `_redirects`.
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readFolder } from '@pwfabric/pack'
import { readPwpack } from '@pwfabric/pack'
import { readFile } from 'node:fs/promises'
import { CommandFailure } from './failure.js'
import { isObject } from './app-files.js'
import { parseRedirectsFile, redirectFor, REDIRECTS_FILE, type RedirectRule } from './static-server.js'
import { PWF_DIR } from './project.js'

/** Folders the build writes for the runtime: their files are not addresses a visitor keeps. */
export const RUNTIME_FOLDERS = ['assets/', 'blocks/', 'engines/', 'shims/']
/** Files of the build that are for the host, not the visitor. */
export const HOST_FILES = new Set(['_headers', '_redirects', 'publish.json'])

export interface BuiltOutput {
  /** The folder (absolute), or the archive. */
  readonly label: string
  readonly files: ReadonlyMap<string, Uint8Array>
  /** `path` when the build wrote a document per page, else `hash`. */
  readonly router: 'hash' | 'path'
  /** The `<base href>` of index.html, ending in `/` (default `/`). */
  readonly base: string
  /** Page keys (`surfaceOrder`). */
  readonly routes: readonly string[]
  /** Every page address from the base, in every locale (`""`, `pricing/`, `de/preise/`). */
  readonly addresses: readonly string[]
  /** The entry page's key, and its address in each locale (`""`, `de/`). */
  readonly entry?: { readonly key: string; readonly addresses: readonly string[] }
  readonly redirects: readonly RedirectRule[]
}

const text = (bytes: Uint8Array | undefined): string => (bytes ? new TextDecoder().decode(bytes) : '')

/**
 * Reads a built pwapp: a folder with an `index.html`, an app folder (its
 * `.pwf/out`), or a `.pwapp` archive.
 */
export async function readBuiltOutput(path: string): Promise<BuiltOutput> {
  const st = await stat(path).catch(() => null)
  if (!st) throw new CommandFailure('OUTPUT_MISSING', `no such file or folder: ${path}`)
  let files: ReadonlyMap<string, Uint8Array>
  let label = path
  if (st.isDirectory()) {
    let dir = path
    if (!(await stat(join(dir, 'index.html')).catch(() => null)) && (await stat(join(dir, 'pwpack.json')).catch(() => null))) dir = join(dir, PWF_DIR, 'out')
    if (!(await stat(join(dir, 'index.html')).catch(() => null))) throw new CommandFailure('OUTPUT_MISSING', `${dir} has no index.html; build the app first (pwf build)`)
    files = (await readFolder(dir, { ignore: new Set() })).files
    label = dir
  } else {
    files = (await readPwpack(new Uint8Array(await readFile(path)))).files
    if (!files.has('index.html')) throw new CommandFailure('OUTPUT_MISSING', `${path} has no index.html at its root; it is not a built pwapp`)
  }
  const index = text(files.get('index.html'))
  const base = /<base\s[^>]*href="([^"]*)"/i.exec(index)?.[1] ?? '/'
  let project: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text(files.get('pwpack/project.json')) || '{}') as unknown
    if (isObject(parsed)) project = parsed
  } catch {
    // no project: no routes known
  }
  const routes = Array.isArray(project['surfaceOrder']) ? project['surfaceOrder'].filter((k): k is string => typeof k === 'string') : []
  const entry = typeof project['entrySurfaceId'] === 'string' ? project['entrySurfaceId'] : routes[0]
  const addresses = new Set<string>()
  const entryAddresses = new Set<string>()
  if (isObject(project['addresses'])) {
    for (const row of Object.values(project['addresses'])) {
      if (!isObject(row)) continue
      for (const a of Object.values(row)) if (typeof a === 'string') addresses.add(a)
      if (entry !== undefined && typeof row[entry] === 'string') entryAddresses.add(row[entry] as string)
    }
  } else {
    for (const key of routes) addresses.add(key === entry ? '' : `${key}/`)
  }
  const pathRouted = files.has('404.html') || routes.some((k) => k !== entry && files.has(`${k}/index.html`))
  return {
    label,
    files,
    router: pathRouted ? 'path' : 'hash',
    base: base.endsWith('/') ? base : `${base}/`,
    routes,
    addresses: [...addresses],
    ...(entry !== undefined ? { entry: { key: entry, addresses: entryAddresses.size > 0 ? [...entryAddresses] : [''] } } : {}),
    redirects: parseRedirectsFile(text(files.get(REDIRECTS_FILE))),
  }
}

/** The page documents a visitor opens: every `.html` outside the runtime folders and `pwpack/`. */
export function pageDocuments(out: BuiltOutput): string[] {
  return [...out.files.keys()].filter((p) => p.endsWith('.html') && !p.startsWith('pwpack/') && !RUNTIME_FOLDERS.some((f) => p.startsWith(f))).sort()
}

/** The address a document is served at, from the base: `index.html` → `""`, `pricing/index.html` → `pricing/`. */
export function documentAddress(rel: string): string {
  if (rel === 'index.html') return ''
  if (rel.endsWith('/index.html')) return rel.slice(0, -'index.html'.length)
  return rel
}

/** Where a path below the base (no leading `/`) is served from: a file, an index, a redirect, or nothing. */
export function resolveServed(out: BuiltOutput, rel: string, depth = 0): { file?: string; redirectedTo?: string } {
  const candidates = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`]
  for (const c of candidates) if (out.files.has(c)) return { file: c }
  const hit = redirectFor(out.redirects, `${out.base}${rel}`) ?? redirectFor(out.redirects, `/${rel}`)
  if (hit && depth < 5) {
    if (/^https?:\/\//i.test(hit.location)) return { redirectedTo: hit.location }
    const target = hit.location.startsWith(out.base) ? hit.location.slice(out.base.length) : hit.location.replace(/^\//, '')
    const next = resolveServed(out, target.split(/[?#]/)[0] as string, depth + 1)
    return { ...next, redirectedTo: hit.location }
  }
  return {}
}
