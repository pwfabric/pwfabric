/**
 * Entry wrappers — the thin module the compiler actually bundles.
 *
 * Which template applies is decided by the kind's `entry` metadata in
 * `@pwfabric/contracts` (`atomKindMeta(kind).entry`), not by
 * ad-hoc "block vs capability vs connector" branches:
 *
 * - block (identity)      → re-export the component and the definition under
 *                           the stable names `Component` + `definition`, so the
 *                           runtime's block module loader reads two fixed keys
 *                           whatever the author named them.
 * - capability (identity)  → opaque `export *` (the handler contract is not
 *                           normalised).
 * - connector (sibling)    → loader-contract adapter: `createConnector` that
 *                           delegates to an explicit export, wraps an engine
 *                           class (`prototype.query`), or calls/constructs the
 *                           default export of the sibling `./<Name>`.
 * - provider (sibling)     → per-facet entry over the SHARED vendor motor
 *                           (`../index`): binds the domain's entity map from
 *                           `./<domain>` into the vendor engine class, or falls
 *                           back to a vendor `create*` factory.
 *
 * @module @pwfabric/compiler/wrappers
 */
import { atomKindMeta, type AtomKind } from '@pwfabric/contracts'

/**
 * Context passed to the wrapper registry. `identity` kinds supply `sourceBase`
 * (basename of the atom's own source, no extension); `sibling-generated` kinds
 * supply `engineName` (connector `<Name>` / provider `<domain>`).
 */
export interface WrapperContext {
  readonly sourceBase?: string
  readonly engineName?: string
}

/**
 * NAMES ARE UNTRUSTED. `engineName` and `sourceBase` come from pack folder and
 * file names, and they are written into generated SOURCE — a name carrying a
 * quote, a newline or `'; …; //` would be code that no screen ever looked at.
 * Two defences, both always on: the name must match a strict pattern (checked
 * here and, as a diagnostic, by `compileAtom` before it gets this far), and
 * every specifier, property key and message built from a name is emitted
 * through `JSON.stringify`, never spliced between hand-written quotes.
 */
const ENGINE_NAME_RE = /^[A-Za-z0-9_-]+$/
const SOURCE_BASE_RE = /^[A-Za-z0-9_.-]+$/

/** Connector `<Name>` / provider `<domain>`: letters, digits, `_`, `-`. */
export function isValidEngineName(name: string): boolean {
  return ENGINE_NAME_RE.test(name)
}

/** Entry basename without extension: letters, digits, `_`, `-`, `.` — never `..`. */
export function isValidSourceBase(base: string): boolean {
  return SOURCE_BASE_RE.test(base) && !base.includes('..') && base !== '.'
}

/**
 * The single wrapper registry, keyed off the kind's contract metadata.
 * Throws on a name that fails {@link isValidEngineName} / {@link isValidSourceBase}.
 */
export function buildWrapperSource(kind: AtomKind, ctx: WrapperContext): string {
  const meta = atomKindMeta(kind)
  if (meta.entry === 'sibling-generated') {
    const name = ctx.engineName ?? ''
    if (!isValidEngineName(name)) throw new Error(`invalid engine name ${JSON.stringify(name)}`)
    return kind === 'provider' ? providerEntrySource(name) : connectorEntrySource(name)
  }
  // identity
  const sourceBase = ctx.sourceBase ?? ''
  if (!isValidSourceBase(sourceBase)) throw new Error(`invalid entry basename ${JSON.stringify(sourceBase)}`)
  if (kind === 'block') {
    return `import * as _atom from ${JSON.stringify(`./${sourceBase}.js`)}

const _isDef = (v) =>
  v != null && typeof v === 'object' && 'type' in v && 'schema' in v

const _resolveDefinition = (m) => {
  for (const k of Object.keys(m)) {
    const v = m[k]
    if (_isDef(v)) return v
  }
  return null
}

const _resolveComponent = (m) => {
  if (typeof m.default === 'function') return m.default
  // A block written with defineBlock() exports only its definition, and the
  // definition carries the component.
  const d = _resolveDefinition(m)
  if (d && typeof d.component === 'function') return d.component
  for (const k of Object.keys(m)) {
    const v = m[k]
    if (typeof v === 'function') return v
  }
  return null
}

export const definition = _resolveDefinition(_atom)
export const Component = _resolveComponent(_atom)
`
  }
  // capability + any other identity kind
  return `export * from ${JSON.stringify(`./${sourceBase}.js`)}\n`
}

// ── sibling-generated engine adapters ──

const SHARED_ENGINE_HELPERS = `
const _isEngineClass = (v: unknown): boolean =>
  typeof v === 'function' &&
  !!(v as { prototype?: { query?: unknown } }).prototype &&
  typeof (v as { prototype: { query?: unknown } }).prototype.query === 'function'
`

/**
 * Wrapper for kind='connector' — adapts `connectors/<Name>.ts` to the loader
 * contract. Priority: explicit `createConnector` export → engine class
 * (`prototype.query`) → default export (called or constructed).
 */
function connectorEntrySource(name: string): string {
  return `// AUTO-GENERATED (pwfabric-compiler) — loader-contract adapter.
import * as _mod from ${JSON.stringify(`./${name}`)}
${SHARED_ENGINE_HELPERS}
export function createConnector(
  getAccessToken: () => Promise<string | null>,
  config: Record<string, unknown>
): unknown {
  const m = _mod as Record<string, unknown>
  const direct = m['createConnector']
  if (typeof direct === 'function' && !_isEngineClass(direct)) {
    return (direct as (t: unknown, c: unknown) => unknown)(getAccessToken, config)
  }
  for (const k of Object.keys(m)) {
    const v = m[k]
    if (_isEngineClass(v)) {
      return new (v as new (t: unknown, c: unknown) => unknown)(getAccessToken, config)
    }
  }
  const d = m['default']
  if (typeof d === 'function') {
    return _isEngineClass(d)
      ? new (d as new (t: unknown, c: unknown) => unknown)(getAccessToken, config)
      : (d as (t: unknown, c: unknown) => unknown)(getAccessToken, config)
  }
  throw new Error(
    ${JSON.stringify(`connector module "${name}" exports no engine (createConnector / class with query() / default)`)}
  )
}
export default createConnector
`
}

/**
 * Wrapper for kind='provider' — thin per-facet entry over the SHARED vendor
 * motor. Binds the domain: the entity module's EntityMap + the vendor index's
 * engine class (`new Engine(getAccessToken, domainMap)`). Falls back to a
 * vendor-level `create*` factory (all-domain engine) when no engine class is
 * exported.
 */
function providerEntrySource(domain: string): string {
  return `// AUTO-GENERATED (pwfabric-compiler) — per-facet engine entry.
import * as _vendor from '../index'
import * as _domain from ${JSON.stringify(`./${domain}`)}
${SHARED_ENGINE_HELPERS}
const _isEntityMap = (v: unknown): boolean => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const vals = Object.values(v as Record<string, unknown>)
  return vals.length > 0 && vals.every((x) => !!x && typeof x === 'object')
}

const _domainMap = (() => {
  const m = _domain as Record<string, unknown>
  if (_isEntityMap(m[${JSON.stringify(domain)}])) return m[${JSON.stringify(domain)}]
  if (_isEntityMap(m['default'])) return m['default']
  for (const k of Object.keys(m)) if (_isEntityMap(m[k])) return m[k]
  return null
})()

export function createConnector(
  getAccessToken: () => Promise<string | null>,
  config: Record<string, unknown>
): unknown {
  const vendor = _vendor as Record<string, unknown>
  if (_domainMap) {
    for (const k of Object.keys(vendor)) {
      const v = vendor[k]
      if (_isEngineClass(v)) {
        return new (v as new (t: unknown, m: unknown) => unknown)(getAccessToken, _domainMap)
      }
    }
  }
  for (const k of Object.keys(vendor)) {
    const v = vendor[k]
    if (typeof v === 'function' && !_isEngineClass(v) && k.startsWith('create')) {
      return (v as (t: unknown, c: unknown) => unknown)(getAccessToken, config)
    }
  }
  throw new Error(
    ${JSON.stringify(`provider module "${domain}" — vendor index exposes no engine class or create* factory`)}
  )
}
export default createConnector
`
}
