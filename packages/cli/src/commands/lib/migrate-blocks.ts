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
 * and writes the merged `definition.props`:
 *
 * - the SHAPE, the DEFAULT and REQUIRED come from the schema, which is what
 *   rendered until now (zod parsed every block's props);
 * - `bindable`, `copy`, `description` and the human `type` string come from
 *   the manifest, which the schema cannot say;
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
import { PROP_SHAPE_KEYWORDS, propShapeProblems, type BlockPropDescriptor, type PropShape } from '@pwfabric/contracts'

/** One disagreement between a block's schema and its manifest. */
export interface MigrationFinding {
  readonly prop: string
  readonly kind: 'only-in-schema' | 'only-in-manifest' | 'type' | 'default' | 'enum' | 'required' | 'unrepresentable'
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

/** The descriptors a schema yields, with what could not be carried. */
export function descriptorsFromSchema(schema: z.ZodObject): { props: BlockPropDescriptor[]; dropped: string[] } {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  const dropped: string[] = []
  const required = new Set(Array.isArray(json['required']) ? (json['required'] as string[]) : [])
  const props: BlockPropDescriptor[] = []
  for (const [name, node] of Object.entries(isRecord(json['properties']) ? json['properties'] : {})) {
    const shape = toShape(node, name, dropped)
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

/** The manifest's prop shape, if any, with its own default folded in (descriptor first). */
const manifestDefault = (d: BlockPropDescriptor | undefined): unknown =>
  d === undefined ? undefined : d.default !== undefined ? d.default : d.jsonSchema?.default

/**
 * Compares a schema's descriptors with a manifest's and merges them (see the
 * module header for which side wins what).
 */
export function mergeProps(
  fromSchema: readonly BlockPropDescriptor[],
  fromManifest: readonly BlockPropDescriptor[]
): { props: BlockPropDescriptor[]; findings: MigrationFinding[] } {
  const findings: MigrationFinding[] = []
  const schemaBy = new Map(fromSchema.map((d) => [d.name, d]))
  const out: BlockPropDescriptor[] = []
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
    const md = manifestDefault(m)
    if (!same(md, s.default)) {
      findings.push({ prop: m.name, kind: 'default', message: `${m.name}: default ${show(md)} in the manifest, ${show(s.default)} in the schema — the schema's` })
    }
    if (ms && !same(ms.enum ? [...ms.enum].map(String).sort() : undefined, ss?.enum ? [...ss.enum].map(String).sort() : undefined)) {
      findings.push({ prop: m.name, kind: 'enum', message: `${m.name}: values ${show(ms.enum)} in the manifest, ${show(ss?.enum)} in the schema — the schema's` })
    }
    if (Boolean(m.required) !== Boolean(s.required)) {
      findings.push({ prop: m.name, kind: 'required', message: `${m.name}: ${m.required ? 'required' : 'optional'} in the manifest, ${s.required ? 'required' : 'optional'} in the schema — the schema's` })
    }
    // The schema's shape, keeping the manifest's words for people.
    const description = m.jsonSchema?.description
    const shape: PropShape = { ...(ss ?? {}), ...(description !== undefined ? { description } : {}) }
    const merged: Record<string, unknown> = { ...m }
    delete merged['required']
    delete merged['default']
    merged['jsonSchema'] = shape
    if (s.required) merged['required'] = true
    if (s.default !== undefined) merged['default'] = s.default
    if (merged['type'] === undefined && s.type !== undefined) merged['type'] = s.type
    out.push(merged as unknown as BlockPropDescriptor)
  }
  const known = new Set(fromManifest.map((d) => d.name))
  for (const s of fromSchema) {
    if (known.has(s.name)) continue
    findings.push({ prop: s.name, kind: 'only-in-schema', message: `${s.name}: the schema declares it, the manifest does not — added` })
    out.push({ ...s, bindable: true })
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
  const { props, findings } = mergeProps(fromSchema, existing)
  for (const d of dropped) findings.push({ prop: d.split(':')[0] ?? '', kind: 'unrepresentable', message: `${d} — the schema says it, a prop shape cannot; dropped` })
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
