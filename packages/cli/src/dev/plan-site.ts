/**
 * What `app/plan.json` asks of the served site beyond its pages: the
 * third-party scripts it loads once the visitor consents (`scripts`), the
 * response headers it adds (`headers`) and the addresses it sends elsewhere
 * (`redirects`).
 *
 *   "scripts":   [{ "key": "visits", "src": "https://cdn.example.com/tag.js",
 *                   "origins": { "connect": ["https://collect.example.com"] },
 *                   "consent": "analytics" }]
 *   "headers":   [{ "path": "/*", "headers": { "Permissions-Policy": "camera=()" } }]
 *   "redirects": [{ "from": "/old", "to": "/new/", "status": 301 }]
 *
 * Each is checked here, whatever wrote the plan, and refused with an error
 * naming the field: a script's origins go into the app's Content Security
 * Policy and a header or a redirect into a file a host reads line by line
 * and field by field, so a value that is not exactly what it seems would open
 * the app wider than its author meant.
 *
 * A script is not in any document the build writes: the runner loads it once
 * the visitor has consented to its category (`project.json` `scripts`).
 *
 * @module @pwfabric/cli/dev/plan-site
 */
import type { BlockOrigins } from '@pwfabric/contracts'
import { safeParseBlockOrigins } from '@pwfabric/contracts/schemas'
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord } from './sources.js'

const PLAN = 'app/plan.json'

/** One script the app loads once the visitor consents (`plan.json` `scripts[]`). */
export interface PlanScript {
  /** The script's name in the app, unique among its scripts. */
  readonly key: string
  /** An absolute https address on an exact origin; that origin is allowed in script-src. */
  readonly src: string
  /** A Subresource Integrity value (`sha384-…`), when the author pins the script's bytes. */
  readonly integrity?: string
  /** The further origins it reaches: `script`, `connect`, `img`. */
  readonly origins?: Pick<BlockOrigins, 'script' | 'connect' | 'img'>
  /** The consent category it waits for. */
  readonly consent: string
}

/** One rule of `plan.json` `headers[]`: a path pattern and the headers it adds. */
export interface PlanHeaderRule {
  readonly path: string
  readonly headers: readonly (readonly [string, string])[]
}

/** One entry of `plan.json` `redirects[]`. */
export interface PlanRedirect {
  readonly from: string
  readonly to: string
  readonly status: number
}

/** The statuses a redirect may answer with. */
export const REDIRECT_STATUSES: readonly number[] = [301, 302, 307, 308]

/** A script key or a consent category: lower-case words joined by `-`. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** A Subresource Integrity value. */
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/
/**
 * A script's address: https, a lower-case host or a bracketed IPv6 address,
 * an optional port, then a path of visible ASCII — no userinfo, no wildcard.
 */
const SCRIPT_SRC = /^https:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?\/[\x21-\x7e]*$/
/** The directives a script's `origins` may name. */
const SCRIPT_DIRECTIVES = ['script', 'connect', 'img'] as const
/**
 * An HTTP header name (a token, RFC 9110 §5.1), not starting with `!`: in a
 * `_headers` file `! Name` takes back a header an earlier rule set — the
 * policy among them.
 */
const HEADER_NAME = /^[#$%&'*+.^_`|~0-9A-Za-z-][!#$%&'*+.^_`|~0-9A-Za-z-]*$/
/** A header value: horizontal tab and visible ASCII with spaces, nothing else (no control character, no line break). */
const HEADER_VALUE = /^[\t\x20-\x7e]+$/
/** Visible ASCII, no whitespace: a path, a redirect's `from` and `to`. */
const VISIBLE = /^[\x21-\x7e]+$/
/** A site path from `/` (not `//`). */
const SITE_PATH = /^\/(?!\/)/

/** The member of `plan` named `key` when it is present, or undefined. */
function memberOf(plan: unknown, key: string): unknown {
  return isRecord(plan) ? plan[key] : undefined
}

/** `plan.json` `scripts`, checked. A malformed entry is dropped with an error (PLAN_SCRIPT_INVALID). */
export function planScriptsOf(plan: unknown, diagnostics: AssembleDiagnostic[]): PlanScript[] {
  const raw = memberOf(plan, 'scripts')
  if (raw === undefined) return []
  const fail = (message: string): void => {
    diagnostics.push({ severity: 'error', code: 'PLAN_SCRIPT_INVALID', message, path: PLAN })
  }
  if (!Array.isArray(raw)) {
    fail('scripts must be an array of { key, src, integrity?, origins?, consent }')
    return []
  }
  const out: PlanScript[] = []
  const keys = new Set<string>()
  raw.forEach((entry: unknown, i: number) => {
    const at = `scripts[${i}]`
    if (!isRecord(entry)) return fail(`${at} must be an object { key, src, integrity?, origins?, consent }`)
    const unknown = Object.keys(entry).filter((k) => !['key', 'src', 'integrity', 'origins', 'consent'].includes(k))
    if (unknown.length > 0) return fail(`${at} has members a script does not take (${unknown.join(', ')}): key, src, integrity, origins, consent`)
    const key = entry['key']
    if (typeof key !== 'string' || key.length > 60 || !NAME.test(key)) return fail(`${at}.key must be lower-case words joined by - (visits)`)
    if (keys.has(key)) return fail(`${at}.key "${key}" names another script too`)
    const src = entry['src']
    if (typeof src !== 'string' || !SCRIPT_SRC.test(src)) {
      return fail(`${at}.src must be an absolute https address on an exact origin: a lower-case host, an optional port, a path; no user name, no wildcard, no whitespace or control character`)
    }
    // What the URL parser makes of it is what the policy will allow: it must
    // be the origin as written (an explicit :443 is not).
    let url: URL
    try {
      url = new URL(src)
    } catch {
      return fail(`${at}.src "${src}" is not an absolute address`)
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.host.includes('*') || !src.startsWith(`${url.origin}/`)) {
      return fail(`${at}.src "${src}": its origin is ${url.origin}, not the origin as written; write it as ${url.origin}${url.pathname}`)
    }
    const integrity = entry['integrity']
    if (integrity !== undefined && (typeof integrity !== 'string' || !INTEGRITY.test(integrity))) {
      return fail(`${at}.integrity must be a Subresource Integrity value (sha384-<base64>)`)
    }
    let origins: PlanScript['origins']
    if (entry['origins'] !== undefined) {
      const o = entry['origins']
      const other = isRecord(o) ? Object.keys(o).filter((d) => !(SCRIPT_DIRECTIVES as readonly string[]).includes(d)) : []
      if (!isRecord(o) || other.length > 0) return fail(`${at}.origins names only script, connect and img${other.length ? ` (not ${other.join(', ')})` : ''}`)
      const declared = safeParseBlockOrigins(o)
      if (!declared.ok) return fail(`${at}.origins — ${declared.issues.join('; ')}`)
      origins = declared.value
    }
    const consent = entry['consent']
    if (typeof consent !== 'string' || consent.length > 40 || !NAME.test(consent)) {
      return fail(`${at}.consent must be the consent category the script waits for, lower-case words joined by - (analytics)`)
    }
    keys.add(key)
    out.push({ key, src, ...(integrity !== undefined ? { integrity: integrity as string } : {}), ...(origins ? { origins } : {}), consent })
  })
  return out
}

/** What the policy allows for the app's scripts, by directive: each `src`'s origin and `origins.script`; `connect`; `img`. */
export function planScriptOrigins(scripts: readonly PlanScript[]): { readonly origins: BlockOrigins }[] {
  return scripts.map((s) => ({
    origins: {
      script: [new URL(s.src).origin, ...(s.origins?.script ?? [])],
      ...(s.origins?.connect ? { connect: s.origins.connect } : {}),
      ...(s.origins?.img ? { img: s.origins.img } : {}),
    },
  }))
}

/** `plan.json` `headers`, checked. A malformed rule is dropped with an error (PLAN_HEADER_INVALID). */
export function planHeadersOf(
  plan: unknown,
  diagnostics: AssembleDiagnostic[],
  engineRules: readonly { readonly path: string; readonly headers: readonly string[] }[] = []
): PlanHeaderRule[] {
  const raw = memberOf(plan, 'headers')
  if (raw === undefined) return []
  const fail = (message: string): void => {
    diagnostics.push({ severity: 'error', code: 'PLAN_HEADER_INVALID', message, path: PLAN })
  }
  if (!Array.isArray(raw)) {
    fail('headers must be an array of { path, headers: { Name: value } }')
    return []
  }
  const out: PlanHeaderRule[] = []
  raw.forEach((entry: unknown, i: number) => {
    const at = `headers[${i}]`
    if (!isRecord(entry) || !isRecord(entry['headers'])) return fail(`${at} must be { path, headers: { Name: value } }`)
    const path = entry['path']
    if (typeof path !== 'string' || !VISIBLE.test(path) || !SITE_PATH.test(path)) {
      return fail(`${at}.path must be a site path from /, visible ASCII with no whitespace (/*, /docs/*, /about)`)
    }
    const headers: [string, string][] = []
    for (const [name, value] of Object.entries(entry['headers'])) {
      if (!HEADER_NAME.test(name)) return fail(`${at}: "${name}" is not a header name (an HTTP token, not starting with !)`)
      if (name.toLowerCase() === 'content-security-policy') {
        return fail(`${at}: Content-Security-Policy is the build's own, derived from what the app declares; the plan cannot set it`)
      }
      if (typeof value !== 'string' || value.trim() === '' || !HEADER_VALUE.test(value)) {
        return fail(`${at}: ${name} must be a non-empty string of visible ASCII, spaces and tabs (no line break or control character)`)
      }
      // A header the engine sets on a path this rule matches too is sent
      // once, the engine's.
      const clash = engineRules.find((r) => pathsOverlap(r.path, path) && r.headers.some((h) => h.toLowerCase() === name.toLowerCase()))
      if (clash) return fail(`${at}: ${name} is set by the build on ${clash.path}, which ${path} matches too; set it on paths the build sets nothing on`)
      headers.push([name, value.trim()])
    }
    if (headers.length > 0) out.push({ path, headers })
  })
  return out
}

/** Whether two `_headers` patterns (`*` matching any run of characters) can match one path. */
export function pathsOverlap(a: string, b: string): boolean {
  const parts = (p: string): [string, string] | undefined => {
    const star = p.indexOf('*')
    return star < 0 ? undefined : [p.slice(0, star), p.slice(star + 1).replace(/\*/g, '')]
  }
  const matches = (pattern: string, path: string): boolean => {
    const p = parts(pattern)
    if (!p) return pattern === path
    return path.length >= p[0].length + p[1].length && path.startsWith(p[0]) && path.endsWith(p[1])
  }
  const pa = parts(a)
  const pb = parts(b)
  if (!pa) return matches(b, a)
  if (!pb) return matches(a, b)
  const headsAgree = pa[0].startsWith(pb[0]) || pb[0].startsWith(pa[0])
  const tailsAgree = pa[1].endsWith(pb[1]) || pb[1].endsWith(pa[1])
  return headsAgree && tailsAgree
}

/**
 * `plan.json` `redirects`, checked. A malformed entry is dropped with an error
 * (PLAN_REDIRECT_INVALID); so is one from an address the app serves (`served`:
 * a host answers the file first, so it would never apply) or to itself.
 */
export function planRedirectsOf(plan: unknown, diagnostics: AssembleDiagnostic[], served: (path: string) => boolean = () => false): PlanRedirect[] {
  const raw = memberOf(plan, 'redirects')
  if (raw === undefined) return []
  const fail = (message: string): void => {
    diagnostics.push({ severity: 'error', code: 'PLAN_REDIRECT_INVALID', message, path: PLAN })
  }
  if (!Array.isArray(raw)) {
    fail('redirects must be an array of { from, to, status? }')
    return []
  }
  const out: PlanRedirect[] = []
  const seen = new Set<string>()
  raw.forEach((entry: unknown, i: number) => {
    const at = `redirects[${i}]`
    if (!isRecord(entry)) return fail(`${at} must be { from, to, status? }`)
    const { from, to } = entry
    const status = entry['status'] ?? 301
    if (typeof from !== 'string' || !VISIBLE.test(from) || !SITE_PATH.test(from) || from.slice(0, -1).includes('*')) {
      return fail(`${at}.from must be a site path from /, visible ASCII with no whitespace, a * only at its end (/old, /blog/*)`)
    }
    let target = false
    if (typeof to === 'string' && VISIBLE.test(to)) {
      if (SITE_PATH.test(to)) target = true
      else {
        try {
          const url = new URL(to)
          target = url.protocol === 'https:' || url.protocol === 'http:'
        } catch {
          target = false
        }
      }
    }
    if (!target) return fail(`${at}.to must be a site path from / or an absolute http(s) address, visible ASCII with no whitespace`)
    if (typeof status !== 'number' || !REDIRECT_STATUSES.includes(status)) {
      return fail(`${at}.status must be one of ${REDIRECT_STATUSES.join(', ')}`)
    }
    if (to === from) return fail(`${at} redirects ${from} to itself`)
    if (!from.endsWith('*') && served(from)) return fail(`${at}.from ${from} is an address the app serves; a host answers it before any redirect`)
    if (seen.has(from)) return fail(`${at}.from "${from}" is redirected more than once`)
    seen.add(from)
    out.push({ from, to: to as string, status })
  })
  return out
}

/**
 * The static-host `_redirects` file: one `from to status` line per redirect,
 * in the plan's order, its site paths under the app's `base`.
 */
export function redirectsFile(redirects: readonly PlanRedirect[], base = '/'): string {
  const root = base.replace(/\/+$/, '')
  const under = (p: string): string => (SITE_PATH.test(p) ? `${root}${p}` : p)
  return redirects.map((r) => `${under(r.from)} ${under(r.to)} ${r.status}\n`).join('')
}
