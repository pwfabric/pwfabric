/**
 * Block props checked against the block manifests: the props a receipt gives a
 * block that its manifest does not describe.
 *
 * A runtime renders such a prop without a word — an unknown name is ignored, a
 * value outside an enum reaches the block as written and draws whatever the
 * block's code makes of it — so the author never learns that `size: "sm"` on a
 * button rendered as `medium`. This check reads
 * only declarative files (each block's `manifest.json` and the app's receipts);
 * no block code runs. Every finding is a WARNING, because the runtime tolerates
 * the prop.
 *
 * The prop's name, its value's JSON type and, where the schema has one, its
 * `enum`/`const` (BLOCK_PROP_UNKNOWN, _TYPE, _ENUM); then the rest of the
 * shape, as the runtime reads it (`checkPropValue`, @pwfabric/contracts): bounds,
 * lengths, patterns, formats, and the members of nested objects and array items
 * (BLOCK_PROP_SHAPE). The members of array items and nested objects are named
 * as the prop's `jsonSchema` names them (`items.properties`, `properties`): a
 * member it does not name is BLOCK_PROP_UNKNOWN too, with its path
 * (`columns[0].label`) and the nearest name when it looks misspelled — unless
 * the schema leaves the object open (`additionalProperties` true or a schema,
 * `patternProperties`, or no `properties` at all). A value
 * that is a binding (a string carrying `{{…}}`, whole or interpolated) resolves
 * at runtime and is not checked — except on a prop the manifest declares
 * `bindable: false`. The runtime leaves such a prop exactly as written, nested
 * values included, so a template anywhere in it would show its braces: that is
 * a warning of its own (BLOCK_PROP_NOT_BINDABLE), and the value is judged as
 * the literal it is. A prop with no `bindable` declaration is bindable.
 */
import { checkPropValue, coercePropValue, type AtomRef, type PropShape } from '@pwfabric/contracts'
import type { PackFolder, PackIssue } from './types.js'

/** A prop is named that the block's manifest does not declare — or a member its schema does not name; the block ignores it. */
export const BLOCK_PROP_UNKNOWN = 'BLOCK_PROP_UNKNOWN'
/** A value is outside the prop's `enum` (or `const`); the block still gets it as written. */
export const BLOCK_PROP_ENUM = 'BLOCK_PROP_ENUM'
/** A value's JSON type is not one the prop's `jsonSchema` accepts. */
export const BLOCK_PROP_TYPE = 'BLOCK_PROP_TYPE'
/** A `{{…}}` template sits in a prop declared `bindable: false`; it is not resolved and renders as written. */
export const BLOCK_PROP_NOT_BINDABLE = 'BLOCK_PROP_NOT_BINDABLE'
/**
 * A value of the right type that does not fit the rest of its declared
 * shape: a bound, a length, a pattern, a format, or a member of a nested
 * object or array item. The runtime keeps the value as written (it is the app's).
 */
export const BLOCK_PROP_SHAPE = 'BLOCK_PROP_SHAPE'

/** One prop as a block manifest declares it; the members this check reads. */
export interface BlockPropDescriptor {
  readonly name: string
  readonly jsonSchema?: unknown
  /** `false`: the prop takes a literal only (block-manifest, "Prop descriptor"). Absent means bindable. */
  readonly bindable?: boolean
  /**
   * `true`: the prop is words a visitor reads (a label, a heading, an
   * accessible name) — the app's to write, in its language (block-manifest,
   * "Prop descriptor"; BLOCK_DEFAULT_COPY).
   */
  readonly copy?: boolean
  /** The prop's default as the descriptor states it (`jsonSchema.default` is read too). */
  readonly default?: unknown
}

/** A block type as the check resolves it. */
export interface BlockPropsEntry {
  /** The atom id (`control.button`). */
  readonly atomId: string
  /** Its declared props, from `definition.props` (or a top-level `props`). */
  readonly props: readonly BlockPropDescriptor[]
}

/** Block type (every name a receipt may use) → its declared props. */
export type BlockPropsCatalog = ReadonlyMap<string, BlockPropsEntry>

/** One folder the catalogue is built from: its files and its atoms (`validatePack(folder).atoms`). */
export interface BlockSource {
  readonly folder: PackFolder
  readonly atoms: readonly AtomRef[]
  /** Where the folder is, as messages print it (`.pwf/packs/<id>@<version>`); absent for the app itself. */
  readonly label?: string
}

/** A page's receipt, a page's receipt for one locale, and the app's layout (receipt §4): the props of each are checked. */
const RECEIPT = /^app\/(?:surfaces\/[^/]+|layout)\.receipt\.json$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function jsonAt(folder: PackFolder, path: string): unknown {
  const bytes = folder.files.get(path)
  if (!bytes) return undefined
  try {
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Every name a block atom answers to in a receipt: its id, its manifest
 * `name`, the id without its first segment, and its last segment
 * (`control.button` → `control.button`, `button`).
 */
export function blockTypeNames(atomId: string, manifest?: Readonly<Record<string, unknown>>): string[] {
  const names = new Set<string>([atomId])
  const name = manifest?.['name']
  if (typeof name === 'string' && name) names.add(name)
  const dot = atomId.indexOf('.')
  if (dot >= 0) names.add(atomId.slice(dot + 1))
  names.add(atomId.slice(atomId.lastIndexOf('.') + 1))
  return [...names]
}

/**
 * A block's names, by how firmly they name it: `exact` — its id and its
 * manifest `name` — and `short` — its id without its first segment and its
 * last segment (`docs.sidebar` → `sidebar`), which another block may share.
 */
export function blockTypeNameParts(atomId: string, manifest?: Readonly<Record<string, unknown>>): { exact: string[]; short: string[] } {
  const exact = new Set<string>([atomId])
  const name = manifest?.['name']
  if (typeof name === 'string' && name) exact.add(name)
  const short = new Set<string>()
  const dot = atomId.indexOf('.')
  if (dot >= 0) short.add(atomId.slice(dot + 1))
  short.add(atomId.slice(atomId.lastIndexOf('.') + 1))
  for (const n of exact) short.delete(n)
  return { exact: [...exact], short: [...short] }
}

/** One block a type may name, in resolution order (the app's own first, then each pinned pack's). */
export interface NamedBlock<T> {
  readonly atom: T
  readonly id: string
  readonly manifest?: Readonly<Record<string, unknown>> | undefined
}

/**
 * The block a receipt's `type` names, the same in `pwf validate`, `pwf build`
 * and the tools that describe a block:
 *
 *  1. the first block (the app's own, then each pinned pack's, in order) whose
 *     id or manifest `name` is the type — a later one of that name is shadowed;
 *  2. else the one block whose short name (its id without its first segment,
 *     or its last segment) is the type;
 *  3. two different blocks by a short name is ambiguous — never a pick by
 *     folder or by order: the receipt writes one of their ids.
 *
 * `shadowed` lists the other blocks the type also names; undefined: none.
 */
export function resolveBlockType<T>(
  type: string,
  blocks: readonly NamedBlock<T>[]
): { atom: T; id: string; shadowed: NamedBlock<T>[] } | { ambiguous: NamedBlock<T>[] } | undefined {
  const parts = blocks.map((b) => ({ block: b, names: blockTypeNameParts(b.id, b.manifest) }))
  const exact = parts.filter((p) => p.names.exact.includes(type)).map((p) => p.block)
  if (exact.length > 0) {
    const [first, ...rest] = exact as [NamedBlock<T>, ...NamedBlock<T>[]]
    return { atom: first.atom, id: first.id, shadowed: rest }
  }
  const short = parts.filter((p) => p.names.short.includes(type)).map((p) => p.block)
  if (short.length === 0) return undefined
  const ids = [...new Set(short.map((b) => b.id))]
  if (ids.length > 1) return { ambiguous: ids.map((id) => short.find((b) => b.id === id) as NamedBlock<T>) }
  const [first, ...rest] = short as [NamedBlock<T>, ...NamedBlock<T>[]]
  return { atom: first.atom, id: first.id, shadowed: rest }
}

/** The blocks of the sources, in resolution order, with their manifests. */
export function namedBlocksOf(sources: readonly BlockSource[]): NamedBlock<AtomRef>[] {
  const out: NamedBlock<AtomRef>[] = []
  for (const source of sources) {
    for (const ref of source.atoms) {
      if (ref.kind !== 'block') continue
      const manifest = jsonAt(source.folder, atomManifestPath(ref))
      out.push({ atom: ref, id: ref.id, ...(isRecord(manifest) ? { manifest } : {}) })
    }
  }
  return out
}

/** The code of a type that names two different blocks by a short name. */
export const BLOCK_TYPE_AMBIGUOUS = 'BLOCK_TYPE_AMBIGUOUS'

/** The `BLOCK_TYPE_AMBIGUOUS` finding: the type, the page that places it, and every block it names. */
export function ambiguousBlockTypeMessage(type: string, pageKey: string, ids: readonly string[]): string {
  return `page "${pageKey}" places a block of type "${type}", which names ${ids.map((i) => `"${i}"`).join(' and ')} by a short name: write the id of the one meant`
}

/** The manifest next to an atom (`manifest.json` beside its entry, or the JSON entry itself). */
export function atomManifestPath(ref: Pick<AtomRef, 'relPath'>): string {
  if (ref.relPath.endsWith('.json')) return ref.relPath
  const slash = ref.relPath.lastIndexOf('/')
  return `${slash >= 0 ? ref.relPath.slice(0, slash + 1) : ''}manifest.json`
}

/**
 * The prop descriptors of a block manifest: `definition.props`, else a
 * top-level `props`. `undefined` when the manifest declares neither, so the
 * block's props cannot be judged.
 */
export function blockPropDescriptors(manifest: unknown): BlockPropDescriptor[] | undefined {
  if (!isRecord(manifest)) return undefined
  const def = manifest['definition']
  const list = isRecord(def) && Array.isArray(def['props']) ? def['props'] : Array.isArray(manifest['props']) ? manifest['props'] : undefined
  if (!list) return undefined
  return list.filter((p): p is BlockPropDescriptor => isRecord(p) && typeof p['name'] === 'string' && p['name'] !== '')
}

/**
 * Builds the catalogue from sources in precedence order (the app first, then
 * its pinned packs in pin order). A name already taken by an earlier block
 * keeps that block, as `pwf dev` resolves it. Blocks whose manifest declares
 * no props are left out.
 */
export function blockPropsCatalog(sources: readonly BlockSource[]): Map<string, BlockPropsEntry> {
  const catalog = new Map<string, BlockPropsEntry>()
  const blocks = namedBlocksOf(sources)
  const names = new Set(blocks.flatMap((b) => blockTypeNames(b.id, b.manifest)))
  // Each name as resolveBlockType resolves it; an ambiguous one is judged by
  // nobody's props (it is BLOCK_TYPE_AMBIGUOUS).
  for (const name of names) {
    const hit = resolveBlockType(name, blocks)
    if (!hit || 'ambiguous' in hit) continue
    const props = blockPropDescriptors(blocks.find((b) => b.atom === hit.atom)?.manifest)
    if (props) catalog.set(name, { atomId: hit.id, props })
  }
  return catalog
}

/** Whether a value carries a binding anywhere (nested in lists and objects too). */
function carriesBinding(value: unknown): boolean {
  if (isBinding(value)) return true
  if (Array.isArray(value)) return value.some(carriesBinding)
  if (isRecord(value)) return Object.values(value).some(carriesBinding)
  return false
}

/** A string carrying a `{{…}}` expression, whole or interpolated: it resolves at runtime. */
export function isBinding(value: unknown): boolean {
  return typeof value === 'string' && /\{\{[\s\S]*?\}\}/.test(value)
}

/*
 * The runtime's own test for a string it resolves (@pwfabric/runtime,
 * render/resolve-expressions.ts: WHOLE_VALUE_PATTERN, HAS_EXPRESSION_PATTERN),
 * mirrored exactly: this package does not depend on the runtime. Keep the two
 * in step.
 */
const WHOLE_VALUE_PATTERN = /^\{\{((?:(?!\}\}).)+)\}\}$/s
const HAS_EXPRESSION_PATTERN = /\{\{.+?\}\}/

/** A string the runtime would resolve as a template (`resolveString`), were its prop bindable. */
export function isTemplate(value: unknown): value is string {
  return typeof value === 'string' && (WHOLE_VALUE_PATTERN.test(value) || HAS_EXPRESSION_PATTERN.test(value))
}

/** The first template in a value, nested in lists and objects too, and where it is (`prop.lines[1].text`). */
function firstTemplate(value: unknown, at: string): { at: string; text: string } | undefined {
  if (isTemplate(value)) return { at, text: value }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = firstTemplate(value[i], `${at}[${i}]`)
      if (found) return found
    }
  } else if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      const found = firstTemplate(v, `${at}.${key}`)
      if (found) return found
    }
  }
  return undefined
}

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'

function jsonTypeOf(v: unknown): JsonType | undefined {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  if (typeof v === 'object') return 'object'
  return undefined
}

function typeAccepts(type: unknown, v: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  const actual = jsonTypeOf(v)
  return types.some((t) => {
    if (typeof t !== 'string') return true
    if (t === 'number') return actual === 'number' || actual === 'integer'
    return t === actual
  })
}

const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))

/** Whether a value fits a schema, shallowly (see the module note). */
function fits(schema: unknown, v: unknown): boolean {
  if (!isRecord(schema)) return true
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key]
    if (Array.isArray(branches) && branches.length > 0 && !branches.some((b) => fits(b, v))) return false
  }
  const all = schema['allOf']
  if (Array.isArray(all) && !all.every((b) => fits(b, v))) return false
  if ('const' in schema && !same(schema['const'], v)) return false
  const values = schema['enum']
  if (Array.isArray(values) && !values.some((e) => same(e, v))) return false
  if (schema['type'] !== undefined && !typeAccepts(schema['type'], v)) return false
  return true
}

interface Accepts {
  /** Literal values from `enum`/`const`. */
  readonly values: unknown[]
  /** Types accepted without a literal list. */
  readonly types: Set<string>
}

/** What a schema accepts, for the message. */
function accepts(schema: unknown, out: Accepts = { values: [], types: new Set() }): Accepts {
  if (!isRecord(schema)) return out
  let branched = false
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[key]
    if (!Array.isArray(branches)) continue
    branched = true
    branches.forEach((b) => accepts(b, out))
  }
  if ('const' in schema) out.values.push(schema['const'])
  else if (Array.isArray(schema['enum'])) out.values.push(...(schema['enum'] as unknown[]))
  else if (schema['type'] !== undefined) {
    for (const t of Array.isArray(schema['type']) ? schema['type'] : [schema['type']]) if (typeof t === 'string') out.types.add(t)
  } else if (!branched) out.types.add('any')
  return out
}

function acceptLine(a: Accepts): string {
  const parts = [...a.values.map((v) => JSON.stringify(v)), ...a.types]
  return parts.join(', ')
}

function short(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

/** The edit distance between two names (Levenshtein), for "did you mean". */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length] as number
}

/** The declared name `name` is most likely a misspelling of, or undefined. */
export function nearestName(name: string, names: readonly string[]): string | undefined {
  const lower = name.toLowerCase()
  let best: { name: string; d: number } | undefined
  for (const n of names) {
    const d = n.toLowerCase() === lower ? 0 : distance(lower, n.toLowerCase())
    if (d <= Math.max(1, Math.floor(Math.min(name.length, n.length) / 3)) && (!best || d < best.d)) best = { name: n, d }
  }
  return best?.name
}

/** The branch of an `anyOf`/`oneOf` a value is read against: the one branch whose type takes it, or none. */
function branchFor(schema: Record<string, unknown>, value: unknown): unknown {
  const branches = schema['anyOf'] ?? schema['oneOf']
  if (!Array.isArray(branches)) return schema
  const taking = branches.filter((b) => isRecord(b) && b['type'] !== undefined && typeAccepts(b['type'], value))
  return taking.length === 1 ? taking[0] : undefined
}

/**
 * The members of a nested value its schema does not name, where they are
 * (`columns[0].label`). Walks array items (`items`) and object members
 * (`properties`); a template value is not walked (it resolves at runtime). An
 * object is closed when its schema names `properties` and leaves no other
 * member open (`additionalProperties` absent or `false`, no
 * `patternProperties`).
 */
function unknownMembers(value: unknown, schema: unknown, at: string, out: { at: string; name: string; known: string[] }[] = []): typeof out {
  if (!isRecord(schema) || isTemplate(value)) return out
  const branch = branchFor(schema, value)
  if (branch !== schema) return unknownMembers(value, branch, at, out)
  if (Array.isArray(value)) {
    if (isRecord(schema['items'])) value.forEach((item, i) => unknownMembers(item, schema['items'], `${at}[${i}]`, out))
    return out
  }
  if (!isRecord(value)) return out
  const props = isRecord(schema['properties']) ? schema['properties'] : undefined
  const extra = schema['additionalProperties']
  for (const [name, member] of Object.entries(value)) {
    if (member === undefined) continue
    const declared = props?.[name]
    if (declared !== undefined) unknownMembers(member, declared, `${at}.${name}`, out)
    else if (isRecord(extra)) unknownMembers(member, extra, `${at}.${name}`, out)
    else if (props && extra !== true && schema['patternProperties'] === undefined) out.push({ at: `${at}.${name}`, name, known: Object.keys(props) })
  }
  return out
}

/** The findings for one value of one prop, or none. */
function valueIssue(
  where: string,
  prop: string,
  value: unknown,
  schema: unknown,
  atomId: string,
  literal: boolean
): Pick<PackIssue, 'code' | 'message'> | undefined {
  if (value === undefined || (!literal && isBinding(value)) || fits(schema, value)) return undefined
  const a = accepts(schema)
  const actual = jsonTypeOf(value)
  const sameKind = a.values.some((x) => {
    const t = jsonTypeOf(x)
    return t === actual || (t === 'integer' && actual === 'number') || (t === 'number' && actual === 'integer')
  })
  if (sameKind) {
    return {
      code: BLOCK_PROP_ENUM,
      message: `${where} sets ${prop} = ${short(value)}, which ${atomId} does not accept (allowed: ${acceptLine(a)}); the block gets it as written`,
    }
  }
  return {
    code: BLOCK_PROP_TYPE,
    message: `${where} sets ${prop} to a ${actual === 'integer' ? 'number' : actual} (${short(value)}); ${atomId} expects ${acceptLine(a)}`,
  }
}

const BREAKPOINT_NAMES = new Set(['xs', 'sm', 'md', 'lg', 'xl', '2xl'])

/**
 * The values a prop is judged by: each breakpoint's (`prop.md`) when it is
 * written as a breakpoint map (an object whose every key is a breakpoint
 * name) and its declared shape does not take an object; else the value.
 */
function breakpointValues(prop: string, value: unknown, schema: unknown): [string, unknown][] {
  const type = isRecord(schema) ? schema['type'] : undefined
  const takesObject = type === 'object' || (Array.isArray(type) && type.includes('object'))
  if (takesObject || !isRecord(value)) return [[prop, value]]
  const keys = Object.keys(value)
  if (keys.length === 0 || !keys.every((k) => BREAKPOINT_NAMES.has(k))) return [[prop, value]]
  return keys.map((k) => [`${prop}.${k}`, value[k]])
}

/**
 * The prop findings for one receipt. `path` is the receipt's pack path, used
 * as each issue's `path`. Block types the catalogue does not know are skipped
 * (an unknown block type is a different finding).
 */
export function checkReceiptBlockProps(receipt: unknown, catalog: BlockPropsCatalog, path: string): PackIssue[] {
  const issues: PackIssue[] = []
  const walk = (node: unknown, at: string): void => {
    if (!isRecord(node)) return
    const type = node['type']
    const entry = typeof type === 'string' ? catalog.get(type) : undefined
    if (entry && isRecord(node['props'])) {
      const id = typeof node['id'] === 'string' && node['id'] ? ` "${node['id']}"` : ''
      const where = `${at} (${type as string}${id})`
      const byName = new Map(entry.props.map((p) => [p.name, p]))
      for (const [propName, raw] of Object.entries(node['props'])) {
        const spec = byName.get(propName)
        if (!spec) {
          if (raw === undefined) continue
          const known = entry.props.map((p) => p.name).join(', ') || 'none'
          issues.push({
            severity: 'warning',
            code: BLOCK_PROP_UNKNOWN,
            path,
            message: `${where} sets "${propName}", which ${entry.atomId} does not declare (its props: ${known}); the block ignores it`,
          })
          continue
        }
        // A breakpoint map (`{ xs: 'column', md: 'row' }`) is judged value by
        // value: the renderer resolves it for the breakpoint it draws at.
        for (const [prop, value] of breakpointValues(propName, raw, spec.jsonSchema)) {
          const literal = spec.bindable === false
          const template = literal ? firstTemplate(value, prop) : undefined
          if (template) {
            issues.push({
              severity: 'warning',
              code: BLOCK_PROP_NOT_BINDABLE,
              path,
              message: `${where} sets ${template.at} to ${short(template.text)}, but ${entry.atomId} declares ${prop} bindable: false; the {{…}} is not resolved and renders as written`,
            })
          }
          const found = valueIssue(where, prop, value, spec.jsonSchema, entry.atomId, literal)
          if (found) issues.push({ severity: 'warning', path, ...found })
          else {
            // The members of its items and nested objects, by name — template values aside.
            for (const member of literal || !isBinding(value) ? unknownMembers(value, spec.jsonSchema, prop) : []) {
              const near = nearestName(member.name, member.known)
              issues.push({
                severity: 'warning',
                code: BLOCK_PROP_UNKNOWN,
                path,
                message:
                  `${at}.props.${member.at} (${type as string}${id}) sets "${member.name}", which ${entry.atomId} does not declare for ${member.at.slice(0, -(member.name.length + 1))} ` +
                  `(its members: ${member.known.join(', ') || 'none'})${near ? `; did you mean "${near}"?` : ''}; the block ignores it`,
              })
            }
          }
          if (!found && isRecord(spec.jsonSchema) && (literal || !carriesBinding(value))) {
            // The rest of the shape, as the runtime reads it: bounds, formats, nested members.
            const shape = spec.jsonSchema as PropShape
            // A member the schema does not name is reported above, by name.
            for (const issue of checkPropValue(coercePropValue(value, shape), shape, prop).filter((i) => i.code !== 'unknownMember')) {
              issues.push({
                severity: 'warning',
                code: BLOCK_PROP_SHAPE,
                path,
                message: `${where} sets ${issue.message.replace(/^([^:]+): /, '$1, which ')}; ${entry.atomId} gets it as written`,
              })
            }
          }
        }
      }
    }
    const children = node['children']
    if (Array.isArray(children)) children.forEach((c, i) => walk(c, `${at}.children[${i}]`))
  }
  if (isRecord(receipt) && Array.isArray(receipt['blocks'])) receipt['blocks'].forEach((b, i) => walk(b, `blocks[${i}]`))
  return issues
}

/**
 * The prop findings for every receipt of an app (`app/surfaces/*.receipt.json`).
 * A receipt that does not parse is skipped; `validatePack` reports it.
 */
export function checkBlockProps(app: PackFolder, catalog: BlockPropsCatalog): PackIssue[] {
  const issues: PackIssue[] = []
  const paths = [...app.files.keys()].filter((p) => RECEIPT.test(p)).sort()
  for (const path of paths) issues.push(...checkReceiptBlockProps(jsonAt(app, path), catalog, path))
  return issues
}
