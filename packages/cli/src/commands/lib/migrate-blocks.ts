/**
 * Moving a block's zod schema into its manifest (engine 3.0).
 *
 * Until 3.0 a pack block declared its props twice: a zod schema in
 * `component.tsx` (`export const <x>PropsSchema = z.object({…})`) and the
 * prop descriptors of its `manifest.json` (`definition.props`). 3.0 keeps the
 * manifest only: the runtime applies it, and no visitor page carries zod.
 *
 * For each block this reads both, reports every disagreement — a prop one side
 * has and the other does not, a different type, default, enum or required —
 * and writes the merged `definition.props`.
 *
 * WHAT RENDERED UNTIL NOW. Before 3.0 the render path never parsed a block's
 * props with its zod schema: a block got the props as written, and what drew
 * for a missing prop was the component's own fallback (`props.gap ?? 'var(…)'`,
 * a destructuring default). The schema was read by tools, never enforced on a
 * page. So the schema is evidence of what the author meant, not of what a
 * visitor saw, and the merge treats it that way:
 *
 * - the SHAPE (types, enum, members) comes from the schema;
 * - a CONSTRAINT the schema adds and the render never enforced — a `format`
 *   (`.url()`), `.int()`, a bound, a length, a pattern, an item count, a
 *   `required` prop or member — is written only where the manifest already
 *   had it; otherwise it is reported ("schema-only constraint, not written"),
 *   so receipts that rendered fine are not refused by a rule they never met.
 *   A `uri` format is never written on an href-like prop or beside a `''`
 *   branch: `/menu` and `#/x` are links too;
 * - the DEFAULT is the component's in-code literal fallback when the code has
 *   one (what drew), else the manifest's, else the schema's; every
 *   disagreement between the three is a finding to review, and a default
 *   taken from the schema alone says so;
 * - where the schema side cannot be written as a prop shape (a recursive
 *   `$ref`, a keyword the subset lacks), the manifest's shape is kept;
 * - `bindable`, `copy` and `description` come from the manifest, which the
 *   schema cannot say; the human `type` string too, unless the shape changed
 *   under it — then it is regenerated (reported);
 * - a prop only the manifest declares is kept (reported);
 * - a prop only the schema declares is added (reported).
 *
 * How the schema is read: the block's entry is bundled with esbuild (its own
 * relative imports included), `zod` resolves to this package's zod, and every
 * other bare import (React, the engine) to an inert stand-in, so only
 * module-level code runs — the schema definitions. Then each schema goes
 * through `z.toJSONSchema` (input side: a field with a default is not
 * required) and is reduced to the prop-shape subset the runtime reads
 * (`PropShape`, @pwfabric/contracts); what it cannot carry is reported.
 *
 * Nothing here runs in a visitor's browser: it is tooling, and zod is allowed.
 *
 * @module @pwfabric/cli/commands/lib/migrate-blocks
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import * as zod from 'zod'
import { z } from 'zod'
import { PROP_SHAPE_KEYWORDS, checkPropValue, propShapeProblems, type BlockPropDescriptor, type PropShape } from '@pwfabric/contracts'

/** One disagreement between a block's schema and its manifest. */
export interface MigrationFinding {
  readonly prop: string
  readonly kind:
    | 'only-in-schema'
    | 'only-in-manifest'
    | 'type'
    | 'default'
    | 'enum'
    | 'required'
    | 'constraint'
    | 'type-string'
    | 'unrepresentable'
  readonly message: string
}

/** What the migration found for one block. */
export interface BlockMigration {
  /** The block's folder, relative to the migrated root (POSIX). */
  readonly dir: string
  /** The export the schema was read from (`badgePropsSchema`, `badgeDefinition.schema`). */
  readonly schemaFrom?: string
  /** Why the block could not be migrated (no schema, the entry does not load, …). */
  readonly error?: string
  readonly findings: readonly MigrationFinding[]
  /** The merged `definition.props`. Absent when the block could not be read. */
  readonly props?: readonly BlockPropDescriptor[]
  /** Whether the merged props differ from the manifest's. */
  readonly changed: boolean
}

const ENTRY_NAMES = ['component.tsx', 'component.ts', 'component.jsx', 'component.js', 'index.tsx', 'index.ts']

/** Every block folder under `root`: a folder with a manifest.json of `kind: "block"` and an entry file. */
export async function findBlockDirs(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name))
    if (names.has('manifest.json') && ENTRY_NAMES.some((n) => names.has(n))) {
      try {
        const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { kind?: unknown }
        if (m.kind === 'block') out.push(dir)
      } catch {
        // not JSON: `pwf validate` says so
      }
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue
      await walk(join(dir, e.name))
    }
  }
  await walk(root)
  return out.sort()
}

/** An inert stand-in for any module a block imports: every member, call and construction returns it. */
const STAND_IN = `const handler = {
  get(_t, k) {
    if (k === '__esModule') return true
    if (k === 'then') return undefined
    if (k === Symbol.toPrimitive) return () => ''
    if (k === Symbol.iterator) return function* () {}
    return standIn
  },
  apply() { return standIn },
  construct() { return standIn },
}
const standIn = new Proxy(function standIn() {}, handler)
module.exports = standIn
`

/** Loads a block entry's module-level exports with zod real and everything else inert. */
async function loadEntry(entry: string): Promise<Record<string, unknown>> {
  // The block's zod is this package's zod, the very instance read below.
  ;(globalThis as { __pwf_migrate_zod?: unknown }).__pwf_migrate_zod = zod
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'pwf-migrate',
        setup(build) {
          build.onResolve({ filter: /^zod(\/.*)?$/ }, () => ({ path: 'zod', namespace: 'pwf-zod' }))
          build.onLoad({ filter: /.*/, namespace: 'pwf-zod' }, () => ({ contents: 'module.exports = globalThis.__pwf_migrate_zod', loader: 'js' }))
          // Bare specifiers only: not the entry, not a relative or absolute path.
          build.onResolve({ filter: /^[^./\\]/ }, (args) =>
            args.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(args.path) ? undefined : { path: args.path, namespace: 'pwf-stand-in' }
          )
          build.onLoad({ filter: /.*/, namespace: 'pwf-stand-in' }, () => ({ contents: STAND_IN, loader: 'js' }))
          build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
        },
      },
    ],
  })
  const code = result.outputFiles[0]?.text ?? ''
  const tmp = await mkdtemp(join(tmpdir(), 'pwf-migrate-'))
  const file = join(tmp, 'entry.mjs')
  try {
    await writeFile(file, code)
    return (await import(pathToFileURL(file).href)) as Record<string, unknown>
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isZodObject = (v: unknown): v is z.ZodObject => v instanceof z.ZodObject

/** The block's props schema: a definition's `schema`, else the one `*PropsSchema` export. */
function propsSchemaOf(mod: Record<string, unknown>, dirName: string): { from: string; schema: z.ZodObject } | string {
  for (const [name, value] of Object.entries(mod)) {
    if (isRecord(value) && typeof value['type'] === 'string' && isZodObject(value['schema'])) {
      return { from: `${name}.schema`, schema: value['schema'] }
    }
  }
  const named = Object.entries(mod).filter(([n, v]) => /PropsSchema$/.test(n) && isZodObject(v)) as [string, z.ZodObject][]
  if (named.length === 1) return { from: named[0]![0], schema: named[0]![1] }
  const key = dirName.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const match = named.find(([n]) => n.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key))
  if (match) return { from: match[0], schema: match[1] }
  return named.length === 0
    ? 'no props schema: the entry exports no block definition with a `schema` and no `*PropsSchema`'
    : `several props schemas (${named.map(([n]) => n).join(', ')}) and none named after the block`
}

/** zod's safe-integer bounds on `.int()`: not a bound the author wrote. */
const SAFE = Number.MAX_SAFE_INTEGER

/** A JSON-Schema node reduced to the prop-shape subset; what it drops is reported. */
function toShape(node: unknown, path: string, dropped: string[]): PropShape {
  if (!isRecord(node)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === 'propertyNames') continue
    if ((k === 'minimum' && v === -SAFE) || (k === 'maximum' && v === SAFE)) continue
    if (!PROP_SHAPE_KEYWORDS.includes(k)) {
      dropped.push(`${path}: "${k}" (${JSON.stringify(v)?.slice(0, 60)})`)
      continue
    }
    if (k === 'items') out[k] = toShape(v, `${path}[]`, dropped)
    else if (k === 'properties' && isRecord(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, toShape(s, `${path}.${n}`, dropped)]))
    } else if (k === 'additionalProperties' && isRecord(v)) out[k] = toShape(v, `${path}.*`, dropped)
    else if ((k === 'anyOf' || k === 'oneOf') && Array.isArray(v)) out[k] = v.map((b, i) => toShape(b, `${path}|${i}`, dropped))
    else out[k] = v
  }
  return out as PropShape
}

const typesOf = (s: PropShape | undefined): string[] => {
  if (!s) return []
  if (s.type !== undefined) return (typeof s.type === 'string' ? [s.type] : [...s.type]).map((t) => (t === 'integer' ? 'number' : t)).sort()
  const branches = s.anyOf ?? s.oneOf
  return branches ? [...new Set(branches.flatMap((b) => typesOf(b)))].sort() : []
}
/** A value as JSON with object keys sorted: key order is not a difference. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (isRecord(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)
const show = (v: unknown): string => (v === undefined ? 'none' : (JSON.stringify(v) ?? String(v)))

/** A TypeScript-ish type string for a shape (the descriptor's human `type`). */
export function typeStringOf(s: PropShape): string {
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(' | ')
  if (s.const !== undefined) return JSON.stringify(s.const)
  const branches = s.anyOf ?? s.oneOf
  if (branches) return branches.map(typeStringOf).join(' | ')
  const types = s.type === undefined ? [] : typeof s.type === 'string' ? [s.type] : [...s.type]
  if (types.length === 0) return 'unknown'
  return types
    .map((t) => {
      if (t === 'integer') return 'number'
      if (t === 'array') return `${s.items ? typeStringOf(s.items) : 'unknown'}[]`
      if (t === 'object') {
        if (isRecord(s.additionalProperties)) return `Record<string, ${typeStringOf(s.additionalProperties)}>`
        if (s.properties) return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${s.required?.includes(k) ? '' : '?'}: ${typeStringOf(v)}`).join('; ')} }`
        return 'Record<string, unknown>'
      }
      return t
    })
    .join(' | ')
}

/** The descriptors a schema yields, with what could not be carried (`prop` is the top-level prop it sits under). */
export function descriptorsFromSchema(schema: z.ZodObject): { props: BlockPropDescriptor[]; dropped: { prop: string; text: string }[] } {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  const dropped: { prop: string; text: string }[] = []
  const required = new Set(Array.isArray(json['required']) ? (json['required'] as string[]) : [])
  const props: BlockPropDescriptor[] = []
  for (const [name, node] of Object.entries(isRecord(json['properties']) ? json['properties'] : {})) {
    const lost: string[] = []
    const shape = toShape(node, name, lost)
    for (const text of lost) dropped.push({ prop: name, text })
    const { default: fallback, ...rest } = shape as PropShape & { default?: unknown }
    props.push({
      name,
      type: typeStringOf(rest),
      ...(required.has(name) ? { required: true } : {}),
      ...(fallback !== undefined ? { default: fallback } : {}),
      jsonSchema: rest,
    })
  }
  return { props, dropped }
}

// ============================================================
// THE COMPONENT'S OWN FALLBACKS
// ============================================================

/** A JS literal a fallback may be: a string, a number, a boolean, `null`, `[]`, `{}`. */
const LITERAL = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60[^\x60$\\]*\x60|-?\d+(?:\.\d+)?(?![\w.])|true\b|false\b|null\b|\[\s*\]|\{\s*\})`

function literalValue(text: string): unknown {
  const t = text.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (/^\[\s*\]$/.test(t)) return []
  if (/^\{\s*\}$/.test(t)) return {}
  if (/^-?\d/.test(t)) return Number(t)
  return t.slice(1, -1).replace(/\\(.)/g, '$1')
}

/**
 * The literal fallback the component's source gives each prop when it is
 * missing — what drew before 3.0, when the render path did not apply the
 * schema. Read from the source text, cheaply: `props.x ?? <literal>` (also
 * through `as T` and a wrapping call, `cssUnit(props.gap as CSSUnit) ?? '…'`)
 * and a destructuring default of `props` (`const { x = <literal> } = props`,
 * `({ props: { x = <literal> } })`). A prop comes back with several values
 * when the code falls back differently in different places. An expression
 * fallback (`props.x ?? other`) is not a literal and is not read.
 */
export function codeFallbacksOf(source: string): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>()
  const add = (name: string, raw: string): void => {
    const value = literalValue(raw)
    const list = out.get(name) ?? []
    if (!list.some((v) => same(v, value))) list.push(value)
    out.set(name, list)
  }
  const nullish = new RegExp(String.raw`\bprops\??\.([A-Za-z_$][\w$]*)\b(?!\s*\()(?:\s+as\s+[\w$.<>\[\]|'" ]+?)?[\s)]*\?\?\s*` + LITERAL, 'g')
  for (const m of source.matchAll(nullish)) add(m[1]!, m[2]!)
  const bodies = [
    ...source.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*props\b/g),
    ...source.matchAll(/\{\s*props\s*:\s*\{([^{}]*)\}/g),
  ]
  const member = new RegExp(String.raw`(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$]*\s*)?=\s*` + LITERAL + String.raw`\s*(?=,|$)`, 'g')
  for (const b of bodies) for (const m of b[1]!.matchAll(member)) add(m[1]!, m[2]!)
  return out
}

// ============================================================
// CONSTRAINTS THE RENDER NEVER ENFORCED
// ============================================================

/** Keywords that narrow a value of the right type: zod has them, the pre-3.0 render never applied them. */
const CONSTRAINTS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems'] as const

/** A prop or member name that holds a link: `/menu` and `#/x` are values it takes, not URIs. */
const HREF_LIKE = /(?:href|url|uri|link|src)$/i

/** Whether a union branch is the empty string (`.url().or(z.literal(''))`). */
const isEmptyStringBranch = (b: PropShape): boolean =>
  b.const === '' || (Array.isArray(b.enum) && b.enum.length === 1 && b.enum[0] === '') || b.maxLength === 0

const typeList = (t: PropShape['type']): string[] => (t === undefined ? [] : typeof t === 'string' ? [t] : [...t])

/**
 * The schema's shape with each constraint the manifest did not already have
 * left out (`notes` says which). `existing` is the manifest's shape at the
 * same place; `key` the member name the shape sits under; `beside` that a
 * `''` branch sits beside it in a union.
 */
function relax(shape: PropShape, existing: PropShape | undefined, path: string, key: string, notes: string[], beside = false): PropShape {
  const out: Record<string, unknown> = { ...shape }
  for (const k of CONSTRAINTS) {
    if (out[k] === undefined) continue
    const uri = k === 'format' && (out[k] === 'uri' || out[k] === 'url')
    if (uri && (HREF_LIKE.test(key) || beside)) {
      notes.push(`${path}: format ${show(out[k])} — a link takes "/x" and "#/x" too (${beside ? "a '' branch beside it" : 'an href-like name'}); not written`)
      delete out[k]
    } else if (!existing || existing[k] === undefined) {
      notes.push(`${path}: ${k} ${show(out[k])} — schema-only constraint, not written`)
      delete out[k]
    }
  }
  const types = typeList(shape.type)
  if (types.includes('integer') && !typeList(existing?.type).includes('integer')) {
    notes.push(`${path}: integer (.int()) — schema-only constraint, not written (number)`)
    const next = [...new Set(types.map((t) => (t === 'integer' ? 'number' : t)))]
    out['type'] = next.length === 1 ? next[0] : next
  }
  if (shape.items) out['items'] = relax(shape.items, existing?.items, `${path}[]`, key, notes)
  if (shape.properties) {
    out['properties'] = Object.fromEntries(
      Object.entries(shape.properties).map(([n, s]) => [n, relax(s, existing?.properties?.[n], `${path}.${n}`, n, notes)])
    )
  }
  if (isRecord(shape.additionalProperties)) {
    const rest = isRecord(existing?.additionalProperties) ? (existing.additionalProperties as PropShape) : undefined
    out['additionalProperties'] = relax(shape.additionalProperties as PropShape, rest, `${path}.*`, key, notes)
  }
  if (shape.required) {
    const had = new Set(existing?.required ?? [])
    const kept = shape.required.filter((n) => had.has(n))
    for (const n of shape.required) if (!had.has(n)) notes.push(`${path}.${n}: required member — schema-only constraint, not written`)
    if (kept.length > 0) out['required'] = kept
    else delete out['required']
  }
  for (const u of ['anyOf', 'oneOf'] as const) {
    const branches = shape[u]
    if (!branches) continue
    const theirs = existing?.[u]
    const empty = branches.some(isEmptyStringBranch)
    out[u] = branches.map((b, i) =>
      relax(b, theirs && theirs.length === branches.length ? theirs[i] : undefined, `${path}|${i}`, key, notes, empty && !isEmptyStringBranch(b))
    )
  }
  return out as PropShape
}

// ============================================================
// THE MERGE
// ============================================================

/** The manifest's prop shape, if any, with its own default folded in (descriptor first). */
const manifestDefault = (d: BlockPropDescriptor | undefined): unknown =>
  d === undefined ? undefined : d.default !== undefined ? d.default : d.jsonSchema?.default

/** What the merge knows beside the two declarations. */
export interface MergeEvidence {
  /** The component's literal fallbacks per prop ({@link codeFallbacksOf}). */
  readonly codeFallbacks?: ReadonlyMap<string, readonly unknown[]>
  /** Props whose schema side lost a keyword on the way to a prop shape (a recursive `$ref`, …). */
  readonly unrepresentable?: ReadonlySet<string>
}

/** The default to write, and the findings about it (see the module header). */
function chooseDefault(
  name: string,
  shape: PropShape,
  fromCode: readonly unknown[] | undefined,
  fromManifest: unknown,
  fromSchema: unknown,
  findings: MigrationFinding[]
): unknown {
  const finding = (message: string): void => {
    findings.push({ prop: name, kind: 'default', message: `${name}: ${message}` })
  }
  if (fromCode && fromCode.length > 1) {
    finding(`the code falls back to several values (${fromCode.map(show).join(', ')}) — none taken; review`)
  } else if (fromCode && fromCode.length === 1) {
    const code = fromCode[0]
    if (fromSchema !== undefined && !same(code, fromSchema)) {
      finding(`default ${show(fromSchema)} in the schema, the code falls back to ${show(code)} (what drew) — the code's`)
    }
    if (fromManifest !== undefined && !same(code, fromManifest)) {
      finding(`default ${show(fromManifest)} in the manifest, the code falls back to ${show(code)} (what drew) — the code's`)
    }
    if (checkPropValue(code, shape, name).length > 0) {
      finding(`the code's fallback ${show(code)} does not fit the shape — no default written; the block's own fallback keeps drawing it`)
      return undefined
    }
    return code
  }
  if (fromManifest !== undefined) {
    if (!same(fromManifest, fromSchema)) {
      finding(`default ${show(fromManifest)} in the manifest, ${show(fromSchema)} in the schema — the manifest's (the render never applied the schema's); review`)
    }
    return fromManifest
  }
  if (fromSchema !== undefined) {
    finding(`default ${show(fromSchema)} from the schema only — the render never applied it (a missing prop reached the block missing); review that the block should draw it`)
  }
  return fromSchema
}

/**
 * Compares a schema's descriptors with a manifest's and merges them (see the
 * module header for which side wins what). `evidence` is what the
 * component's source and the schema's conversion add.
 */
export function mergeProps(
  fromSchema: readonly BlockPropDescriptor[],
  fromManifest: readonly BlockPropDescriptor[],
  evidence: MergeEvidence = {}
): { props: BlockPropDescriptor[]; findings: MigrationFinding[] } {
  const findings: MigrationFinding[] = []
  const schemaBy = new Map(fromSchema.map((d) => [d.name, d]))
  const out: BlockPropDescriptor[] = []
  const merge = (s: BlockPropDescriptor, m: BlockPropDescriptor | undefined): BlockPropDescriptor => {
    const ms = m?.jsonSchema
    let shape: PropShape
    if (evidence.unrepresentable?.has(s.name) && ms) {
      findings.push({ prop: s.name, kind: 'unrepresentable', message: `${s.name}: the schema's shape cannot be written as a prop shape — the manifest's kept` })
      shape = ms
    } else {
      const notes: string[] = []
      shape = relax(s.jsonSchema ?? {}, ms, s.name, s.name, notes)
      for (const n of notes) findings.push({ prop: s.name, kind: 'constraint', message: n })
    }
    // The manifest's words for people stay.
    if (ms?.description !== undefined) shape = { ...shape, description: ms.description }
    if (s.required && !m?.required) {
      findings.push({ prop: s.name, kind: 'constraint', message: `${s.name}: required — schema-only constraint, not written` })
    }
    const fallback = chooseDefault(s.name, shape, evidence.codeFallbacks?.get(s.name), manifestDefault(m), s.default, findings)
    const merged: Record<string, unknown> = { ...(m ?? { name: s.name, bindable: true }) }
    delete merged['required']
    delete merged['default']
    // The human type string follows the shape: kept while what it describes is unchanged.
    const generated = typeStringOf(shape)
    const before = m?.type
    const stale = before === undefined || (ms ? typeStringOf(ms) !== generated : before !== generated)
    if (stale) {
      if (before !== undefined && before !== generated) {
        findings.push({ prop: s.name, kind: 'type-string', message: `${s.name}: type "${before}" no longer says the shape — regenerated as "${generated}"` })
      }
      merged['type'] = generated
    }
    merged['jsonSchema'] = shape
    if (s.required && m?.required) merged['required'] = true
    if (fallback !== undefined) merged['default'] = fallback
    return merged as unknown as BlockPropDescriptor
  }
  for (const m of fromManifest) {
    const s = schemaBy.get(m.name)
    if (!s) {
      findings.push({ prop: m.name, kind: 'only-in-manifest', message: `${m.name}: the manifest declares it, the schema does not — kept as the manifest has it` })
      out.push(m)
      continue
    }
    const ms = m.jsonSchema
    const ss = s.jsonSchema
    if (ms && !same(typesOf(ms), typesOf(ss))) {
      findings.push({ prop: m.name, kind: 'type', message: `${m.name}: type ${typesOf(ms).join('|') || 'any'} in the manifest, ${typesOf(ss).join('|') || 'any'} in the schema — the schema's` })
    }
    if (ms && !same(ms.enum ? [...ms.enum].map(String).sort() : undefined, ss?.enum ? [...ss.enum].map(String).sort() : undefined)) {
      findings.push({ prop: m.name, kind: 'enum', message: `${m.name}: values ${show(ms.enum)} in the manifest, ${show(ss?.enum)} in the schema — the schema's` })
    }
    if (Boolean(m.required) !== Boolean(s.required)) {
      findings.push({ prop: m.name, kind: 'required', message: `${m.name}: ${m.required ? 'required' : 'optional'} in the manifest, ${s.required ? 'required' : 'optional'} in the schema — the manifest's` })
    }
    out.push(merge(s, m))
  }
  const known = new Set(fromManifest.map((d) => d.name))
  for (const s of fromSchema) {
    if (known.has(s.name)) continue
    findings.push({ prop: s.name, kind: 'only-in-schema', message: `${s.name}: the schema declares it, the manifest does not — added` })
    out.push(merge(s, undefined))
  }
  for (const d of out) {
    if (!d.jsonSchema) continue
    for (const problem of propShapeProblems(d.jsonSchema, d.name)) findings.push({ prop: d.name, kind: 'unrepresentable', message: problem })
  }
  return { props: out, findings }
}

/** Migrates one block folder. With `write`, writes the merged props into its manifest. */
export async function migrateBlock(root: string, dir: string, write: boolean): Promise<BlockMigration> {
  const rel = relative(root, dir).split(sep).join('/') || '.'
  const manifestPath = join(dir, 'manifest.json')
  const text = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>
  const definition = isRecord(manifest['definition']) ? manifest['definition'] : {}
  const existing = (Array.isArray(definition['props']) ? definition['props'] : []).filter(
    (p): p is BlockPropDescriptor => isRecord(p) && typeof p['name'] === 'string'
  )
  let entry: string | undefined
  for (const n of ENTRY_NAMES) {
    if (await stat(join(dir, n)).then((s) => s.isFile(), () => false)) {
      entry = join(dir, n)
      break
    }
  }
  if (!entry) return { dir: rel, error: 'no component entry', findings: [], changed: false }
  let mod: Record<string, unknown>
  try {
    mod = await loadEntry(entry)
  } catch (e) {
    return { dir: rel, error: `the entry does not load: ${(e as Error).message.split('\n')[0]}`, findings: [], changed: false }
  }
  const found = propsSchemaOf(mod, dirname(entry).split(sep).pop() ?? '')
  if (typeof found === 'string') {
    // No schema left: the block is already on the manifest alone.
    return { dir: rel, error: found, findings: [], changed: false }
  }
  const { props: fromSchema, dropped } = descriptorsFromSchema(found.schema)
  const source = await readFile(entry, 'utf8')
  const { props, findings } = mergeProps(fromSchema, existing, {
    codeFallbacks: codeFallbacksOf(source),
    unrepresentable: new Set(dropped.map((d) => d.prop)),
  })
  for (const d of dropped) findings.push({ prop: d.prop, kind: 'unrepresentable', message: `${d.text} — the schema says it, a prop shape cannot; dropped` })
  const changed = !same(props, existing)
  if (write && changed) {
    const next = { ...manifest, definition: { ...definition, props } }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  }
  return { dir: rel, schemaFrom: found.from, findings, props, changed }
}

/** Migrates every block under `root`. */
export async function migrateBlocks(root: string, write: boolean): Promise<BlockMigration[]> {
  const out: BlockMigration[] = []
  for (const dir of await findBlockDirs(root)) out.push(await migrateBlock(root, dir, write))
  return out
}
