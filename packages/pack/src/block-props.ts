/**
 * Block props checked against the block manifests: the props a receipt gives a
 * block that its manifest does not describe.
 *
 * A runtime renders such a prop without a word — an unknown name is ignored, a
 * value outside an enum falls back to the block's default — so the author never
 * learns that `size: "sm"` on a button rendered as `medium`. This check reads
 * only declarative files (each block's `manifest.json` and the app's receipts);
 * no block code runs. Every finding is a WARNING, because the runtime tolerates
 * the prop.
 *
 * Deliberately shallow: the prop's name, its value's JSON type and, where the
 * schema has one, its `enum`/`const`. `anyOf`/`oneOf`/`allOf` combine branches;
 * nothing below the top level of an object or array value is checked. A value
 * that is a binding (a string carrying `{{…}}`, whole or interpolated) resolves
 * at runtime and is not checked — except on a prop the manifest declares
 * `bindable: false`. The runtime leaves such a prop exactly as written, nested
 * values included, so a template anywhere in it would show its braces: that is
 * a warning of its own (BLOCK_PROP_NOT_BINDABLE), and the value is judged as
 * the literal it is. A prop with no `bindable` declaration is bindable.
 */
import type { AtomRef } from '@pwfabric/contracts'
import type { PackFolder, PackIssue } from './types.js'

/** A prop is named that the block's manifest does not declare; the block ignores it. */
export const BLOCK_PROP_UNKNOWN = 'BLOCK_PROP_UNKNOWN'
/** A value is outside the prop's `enum` (or `const`); the block falls back to its default. */
export const BLOCK_PROP_ENUM = 'BLOCK_PROP_ENUM'
/** A value's JSON type is not one the prop's `jsonSchema` accepts. */
export const BLOCK_PROP_TYPE = 'BLOCK_PROP_TYPE'
/** A `{{…}}` template sits in a prop declared `bindable: false`; it is not resolved and renders as written. */
export const BLOCK_PROP_NOT_BINDABLE = 'BLOCK_PROP_NOT_BINDABLE'

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

const RECEIPT = /^app\/surfaces\/[^/]+\.receipt\.json$/

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
  const taken = new Set<string>()
  for (const source of sources) {
    for (const ref of source.atoms) {
      if (ref.kind !== 'block') continue
      const manifest = jsonAt(source.folder, atomManifestPath(ref))
      const names = blockTypeNames(ref.id, isRecord(manifest) ? manifest : undefined).filter((n) => !taken.has(n))
      names.forEach((n) => taken.add(n))
      const props = blockPropDescriptors(manifest)
      if (!props) continue
      for (const n of names) catalog.set(n, { atomId: ref.id, props })
    }
  }
  return catalog
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
      message: `${where} sets ${prop} = ${short(value)}, which ${atomId} does not accept (allowed: ${acceptLine(a)}); the block renders its default instead`,
    }
  }
  return {
    code: BLOCK_PROP_TYPE,
    message: `${where} sets ${prop} to a ${actual === 'integer' ? 'number' : actual} (${short(value)}); ${atomId} expects ${acceptLine(a)}`,
  }
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
      for (const [prop, value] of Object.entries(node['props'])) {
        const spec = byName.get(prop)
        if (!spec) {
          if (value === undefined) continue
          const known = entry.props.map((p) => p.name).join(', ') || 'none'
          issues.push({
            severity: 'warning',
            code: BLOCK_PROP_UNKNOWN,
            path,
            message: `${where} sets "${prop}", which ${entry.atomId} does not declare (its props: ${known}); the block ignores it`,
          })
          continue
        }
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
