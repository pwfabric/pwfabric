/**
 * Row fields a receipt reads that its data source's rows do not have.
 *
 * Every data source binds an array of row objects under its id, and a page
 * reads a field of a row by name: `{{item.<f>}}` inside a block-level
 * `repeat` template, a block's field-mapping prop (`headingField`,
 * `labelKey`, `columns[].key`, …), or `{{<src>.0.<f>}}`. A field the rows do
 * not have is `undefined`, not an error, so a misspelt name renders a blank
 * page and nothing reports it. This check reports it (`FIELD_UNKNOWN`, a
 * warning) — but only for a source whose row fields are **known**:
 *
 * - an `entity` source: the fields its `entityType` declares in
 *   `app/definitions/entities.json`, the keys of that collection's records in
 *   `app/content/` and `app/data/`, and the record envelope (`id`,
 *   `entityType`, `createdAt`, `updatedAt`);
 * - an `entity` source whose `connector` names a connection of the app
 *   (`app/definitions/connections.json`) served by a connector or provider
 *   atom whose manifest declares that `entityType` (connector-manifest §4):
 *   `id` and the declared fields. The atom is the first one — the app's own,
 *   then its pinned packs in pin order — whose `connection` is the
 *   connection's `connector` (its `name` when it has none), as `pwf dev`
 *   resolves it;
 * - a `static` source whose `staticData` is a list of objects: their keys;
 * - any source with a `fallback` list of objects: their keys (added to the
 *   above).
 *
 * Any other source — a `rest` source without a fallback, a connector-served
 * source whose connection is not declared or whose engine declares no
 * `entities` for its type, an aggregate, a `state` source — has no known
 * field set and is not checked.
 * The check reads JSON only; no block code runs.
 *
 * @module @pwfabric/pack/row-fields
 */
import { ConnectorEntityDeclarationSchema, connectorEntityFields, type ConnectorEntityDeclaration } from '@pwfabric/contracts'
import type { BlockSource } from './block-props.js'
import type { PackFolder, PackIssue } from './types.js'
import { stripBom } from './manifest.js'

/** Fields every record of an app's own collection carries (data-protocol §5). */
export const RECORD_ENVELOPE_FIELDS: readonly string[] = ['id', 'entityType', 'createdAt', 'updatedAt']

/** How many known fields a message lists before it says "… and n more". */
const LISTED_FIELDS = 12

const SURFACES = 'app/surfaces/'
const RECEIPT_SUFFIX = '.receipt.json'
const ENTITIES_FILE = 'app/definitions/entities.json'
const CONNECTIONS_FILE = 'app/definitions/connections.json'
const RECORD_DIRS = ['app/content/', 'app/data/']

/**
 * Props whose value names a row field, by naming convention: the manifest
 * descriptors carry no marker that says "this string is a field name", so the
 * check goes by name. A prop ending in `Field` or `Key` is a field name
 * (`headingField`, `labelKey`, `rowAccentKey`), except the names that are
 * page-state keys or address parameters. Inside the `columns` prop, a
 * column's `key` and its `*Key` members are field names (`columns[].key`,
 * `hrefKey`). Heuristic by design; a block whose field prop is named
 * otherwise is not checked.
 */
const FIELD_PROP = /(?:Field|Key)$/
const NOT_FIELD_PROP = new Set(['stateKey', 'selectionKey'])
const COLUMN_PROPS = new Set(['columns'])
const isFieldPropName = (name: string): boolean => FIELD_PROP.test(name) && !NOT_FIELD_PROP.has(name) && !name.endsWith('StateKey')
const isColumnFieldName = (name: string): boolean => name === 'key' || isFieldPropName(name)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A name in the expression grammar: `-` between two name characters is part of it (expressions §4.1). */
const NAME = String.raw`[A-Za-z_$][\w$]*(?:-[\w$]+)*`
/** Not preceded by a name character, a `.` or a joining `-`: the start of a path, not a member of one. */
const PATH_START = String.raw`(?<![\w$.\-])`
const EXPRESSION = /\{\{([\s\S]*?)\}\}/g
const WHOLE = /^\{\{([\s\S]*?)\}\}$/
const SLOT = /^\s*[A-Z][A-Z0-9_]*\s*$/
const STRING_LITERAL = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Per-source known row fields, in a stable order (declared first). */
export type RowFieldSets = ReadonlyMap<string, readonly string[]>

/** The entities an app's connection serves, as its engine's manifest declares them. */
export interface ConnectionRowFields {
  /** Where the declaration is, for the message: the engine manifest's path. */
  readonly from: string
  /** `entityType` → its known row fields (`id`, then the declared fields). */
  readonly entities: RowFieldSets
}

/** Connection `name` → what its engine declares. A connection missing here has no known entities. */
export type ConnectionFieldSets = ReadonlyMap<string, ConnectionRowFields>

/**
 * The known row fields of each data source of one receipt. `entities` maps an
 * entity `typeId` to its known fields (declared fields and record keys; the
 * envelope is added here). A source missing from the result has no known set.
 */
export function rowFieldSets(receipt: unknown, entities: RowFieldSets, connections: ConnectionFieldSets = new Map()): Map<string, string[]> {
  return new Map([...knownSources(receipt, entities, connections)].map(([id, k]) => [id, k.fields]))
}

interface KnownSource {
  readonly fields: string[]
  /** Where the fields come from, for the message: `the entity "T"`, `its staticData`, `its fallback rows`. */
  readonly basis: string
}

function knownSources(receipt: unknown, entities: RowFieldSets, connections: ConnectionFieldSets): Map<string, KnownSource> {
  const out = new Map<string, KnownSource>()
  for (const source of dataSourcesOf(receipt)) {
    const id = source['id']
    if (typeof id !== 'string' || !id || source['aggregate'] !== undefined) continue
    const fields = new Set<string>()
    const basis: string[] = []
    const addRows = (rows: unknown, from: string): void => {
      if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRecord)) return
      basis.push(from)
      for (const row of rows) for (const k of Object.keys(row)) fields.add(k)
    }
    const kind = source['kind']
    const entityType = source['entityType']
    const connector = source['connector']
    if (kind === 'entity' && typeof entityType === 'string' && typeof connector === 'string') {
      const declared = connections.get(connector)
      const known = declared?.entities.get(entityType)
      if (declared && known) {
        basis.push(`the entity "${entityType}" of connection "${connector}" (${declared.from})`)
        for (const f of known) fields.add(f)
      }
    } else if (kind === 'entity' && typeof entityType === 'string' && connector === undefined) {
      const declared = entities.get(entityType)
      if (declared) {
        basis.push(`the entity "${entityType}"`)
        for (const f of declared) fields.add(f)
        for (const f of RECORD_ENVELOPE_FIELDS) fields.add(f)
      }
    }
    if (kind === 'static') addRows(source['staticData'], 'its staticData')
    addRows(source['fallback'], 'its fallback rows')
    if (basis.length > 0) out.set(id, { fields: [...fields], basis: basis.join(' and ') })
  }
  return out
}

/** The receipt's data sources: the first `platform/persistence` binding's `config.dataSources`, as the runtime reads them. */
function dataSourcesOf(receipt: unknown): Record<string, unknown>[] {
  if (!isRecord(receipt) || !Array.isArray(receipt['capabilities'])) return []
  const binding = receipt['capabilities'].find(
    (c) => isRecord(c) && (c['capability'] === 'platform/persistence' || c['capability'] === 'persistence'),
  ) as Record<string, unknown> | undefined
  const config = binding?.['config']
  const sources = isRecord(config) ? config['dataSources'] : undefined
  return Array.isArray(sources) ? sources.filter(isRecord) : []
}

interface Read {
  readonly field: string
  readonly source: string
}

/**
 * Reads one evaluated string makes. `scope` is the source whose row `item` is
 * here (undefined outside a repeat over a known source). A string carrying an
 * unresolved slot (`{{UPPER}}` that is not a source id) is skipped whole.
 */
function readsIn(text: string, scope: string | undefined, sources: RowFieldSets): Read[] {
  if (!text.includes('{{')) return []
  const expressions = [...text.matchAll(EXPRESSION)].map((m) => m[1] as string)
  if (expressions.some((e) => SLOT.test(e) && !sources.has(e.trim()))) return []
  const reads: Read[] = []
  for (const expression of expressions) {
    if (scope !== undefined) {
      for (const field of fieldsAfter(expression, 'item', false)) reads.push({ field, source: scope })
    }
    for (const source of sources.keys()) {
      if (!expression.includes(source)) continue
      for (const field of fieldsAfter(expression, source, true)) reads.push({ field, source })
    }
  }
  return reads
}

/**
 * First field names read from rows of `base` in one expression:
 * `base.f` / `base['f']` for `item`; for a source, the row through an index
 * (`base.0.f`, `base[0].f`, `base[0]['f']`) or a list of one read through
 * (`base.f`, not `length` and not a method call).
 */
function fieldsAfter(expression: string, base: string, isSource: boolean): string[] {
  const b = escapeRegExp(base)
  const index = isSource ? String.raw`(?:\.\d+|\[\s*\d+\s*\])?` : ''
  const out: string[] = []
  // Bracket reads first, while the string literals are still there.
  for (const m of expression.matchAll(new RegExp(`${PATH_START}${b}${index}\\[\\s*(['"])((?:(?!\\1)[^\\\\])*)\\1\\s*\\]`, 'g'))) {
    out.push(m[2] as string)
  }
  // Then dotted reads, with string literals blanked so 'item.x' in a string is no read.
  const code = expression.replace(STRING_LITERAL, '""')
  for (const m of code.matchAll(new RegExp(`${PATH_START}${b}(${index})\\.(${NAME})(?![\\w$])(\\s*\\()?`, 'g'))) {
    const viaIndex = (m[1] as string) !== ''
    const name = m[2] as string
    const call = m[3] !== undefined
    if (isSource && !viaIndex && (name === 'length' || call)) continue
    out.push(name)
  }
  return out
}

/** `{{src}}` or `{{src.slice(…)}}`: the rows of `src`, or undefined. */
function wholeSource(value: unknown, sources: RowFieldSets): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = WHOLE.exec(value.trim())
  if (!m) return undefined
  const expression = (m[1] as string).trim()
  const name = /^([^.\s()[\]]+)(?:\.slice\([^()]*\))?$/.exec(expression)?.[1]
  return name !== undefined && sources.has(name) ? name : undefined
}

/** Every string in a value, at any depth. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (isRecord(v)) for (const x of Object.values(v)) strings(x, out)
  return out
}

/** A literal field name prop value: its first path segment, or undefined for an expression or empty value. */
function literalField(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.includes('{{')) return undefined
  const first = v.trim().split('.')[0]
  return first ? first : undefined
}

/** Field-mapping reads of a block that receives exactly one known source's rows whole. */
function fieldPropReads(props: Record<string, unknown>, sources: RowFieldSets): Read[] {
  const bound = new Set<string>()
  for (const v of Object.values(props)) {
    const s = wholeSource(v, sources)
    if (s !== undefined) bound.add(s)
  }
  if (bound.size !== 1) return []
  const source = [...bound][0] as string
  const reads: Read[] = []
  for (const [name, v] of Object.entries(props)) {
    if (isFieldPropName(name)) {
      const field = literalField(v)
      if (field !== undefined) reads.push({ field, source })
    } else if (COLUMN_PROPS.has(name) && Array.isArray(v)) {
      for (const column of v.filter(isRecord)) {
        for (const [member, x] of Object.entries(column)) {
          const field = isColumnFieldName(member) ? literalField(x) : undefined
          if (field !== undefined) reads.push({ field, source })
        }
      }
    }
  }
  return reads
}

/**
 * `FIELD_UNKNOWN` warnings for one receipt. `surface` names the page in the
 * message; `path` is the issue's path.
 */
export function checkReceiptRowFields(
  receipt: unknown,
  entities: RowFieldSets,
  path: string,
  surface: string,
  connections: ConnectionFieldSets = new Map(),
): PackIssue[] {
  const known = knownSources(receipt, entities, connections)
  const sources: RowFieldSets = new Map([...known].map(([id, k]) => [id, k.fields]))
  if (sources.size === 0 || !isRecord(receipt) || !Array.isArray(receipt['blocks'])) return []
  const issues: PackIssue[] = []
  const seen = new Set<string>()
  const report = (blockId: string, read: Read): void => {
    const { fields, basis } = known.get(read.source) as KnownSource
    if (fields.includes(read.field)) return
    const key = `${blockId}\0${read.source}\0${read.field}`
    if (seen.has(key)) return
    seen.add(key)
    const listed = fields.slice(0, LISTED_FIELDS).join(', ')
    const more = fields.length > LISTED_FIELDS ? `, … and ${fields.length - LISTED_FIELDS} more` : ''
    issues.push({
      severity: 'warning',
      code: 'FIELD_UNKNOWN',
      path,
      message: `surface "${surface}", block "${blockId}" reads field "${read.field}" of source "${read.source}", whose rows have no such field (known from ${basis}: ${listed}${more}); it renders empty`,
    })
  }
  const walk = (node: unknown, scope: string | undefined, where: string): void => {
    if (!isRecord(node)) return
    const blockId = typeof node['id'] === 'string' && node['id'] ? node['id'] : typeof node['type'] === 'string' ? `${node['type']} at ${where}` : where
    // A block's own props, condition and repeat are evaluated in the scope around it (expressions §5).
    for (const member of ['props', 'visibleWhen', 'if', 'repeat']) {
      for (const text of strings(node[member])) for (const read of readsIn(text, scope, sources)) report(blockId, read)
    }
    if (isRecord(node['props'])) for (const read of fieldPropReads(node['props'], sources)) report(blockId, read)
    const repeat = node['repeat']
    let inner = scope
    if (typeof repeat === 'string' && repeat.trim()) {
      // A repeat over a known source: `item` is its row. Over anything else
      // (`{{item.reviews}}`, a source with no known fields): unknown.
      inner = wholeSource(repeat, sources)
    }
    const children = node['children']
    if (Array.isArray(children)) children.forEach((child, i) => walk(child, inner, `${where}.children[${i}]`))
  }
  receipt['blocks'].forEach((block, i) => walk(block, undefined, `blocks[${i}]`))
  return issues
}

function parse(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined
  try {
    return JSON.parse(stripBom(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

/** Keys of the records an app ships or develops with for one collection (`.json` `{ data }` or `.jsonl`). */
function recordKeys(folder: PackFolder, typeId: string): string[] {
  const keys = new Set<string>()
  for (const dir of RECORD_DIRS) {
    const json = parse(folder.files.get(`${dir}${typeId}.json`))
    const rows: unknown[] = isRecord(json) && Array.isArray(json['data']) ? json['data'] : []
    const lines = folder.files.get(`${dir}${typeId}.jsonl`)
    if (lines) {
      for (const line of new TextDecoder().decode(lines).split(/\r?\n/)) {
        if (line.trim()) rows.push(parse(new TextEncoder().encode(line)))
      }
    }
    for (const row of rows) if (isRecord(row)) for (const k of Object.keys(row)) keys.add(k)
  }
  return [...keys]
}

/** Each declared entity's known fields: its declared field names, then the keys of its records. */
export function entityFieldSets(folder: PackFolder): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const doc = parse(folder.files.get(ENTITIES_FILE))
  const list = isRecord(doc) && Array.isArray(doc['entities']) ? doc['entities'] : []
  for (const entity of list.filter(isRecord)) {
    const typeId = entity['typeId']
    if (typeof typeId !== 'string' || !typeId) continue
    const fields = new Set<string>()
    for (const f of Array.isArray(entity['fields']) ? entity['fields'].filter(isRecord) : []) {
      if (typeof f['name'] === 'string' && f['name']) fields.add(f['name'])
    }
    for (const k of recordKeys(folder, typeId)) fields.add(k)
    out.set(typeId, [...fields])
  }
  return out
}

/** A manifest's `entities`, keeping the declarations that fit the schema (the pack validation reports the rest). */
function declaredEntities(manifest: unknown): ConnectorEntityDeclaration[] {
  const list = isRecord(manifest) && Array.isArray(manifest['entities']) ? manifest['entities'] : []
  return list.filter((e): e is ConnectorEntityDeclaration => ConnectorEntityDeclarationSchema.safeParse(e).success)
}

/**
 * What each connection of the app (`app/definitions/connections.json`; a bare
 * string entry is `{ name }`) is served by. `sources` are the folders whose
 * connector and provider atoms may serve it, in precedence order — the app
 * first, then its pinned packs in pin order (`validatePack(folder).atoms`);
 * a source's `label` prefixes the manifest path in messages. A connection no
 * atom answers to, or whose engine declares no entities, is left out.
 */
export function connectionFieldSets(app: PackFolder, sources: readonly BlockSource[]): Map<string, ConnectionRowFields> {
  const out = new Map<string, ConnectionRowFields>()
  const doc = parse(app.files.get(CONNECTIONS_FILE))
  const list = isRecord(doc) && Array.isArray(doc['connections']) ? doc['connections'] : []
  for (const raw of list) {
    const entry = typeof raw === 'string' ? { name: raw } : isRecord(raw) ? raw : undefined
    const name = entry?.['name']
    if (typeof name !== 'string' || !name || out.has(name)) continue
    const wanted = typeof entry?.['connector'] === 'string' ? entry['connector'] : name
    const served = engineFor(wanted, sources)
    if (!served) continue
    const entities = connectorEntityFields({ entities: declaredEntities(served.manifest) })
    if (entities.size > 0) out.set(name, { from: served.from, entities })
  }
  return out
}

/** The first connector or provider atom whose manifest `connection` is `wanted`. */
function engineFor(wanted: string, sources: readonly BlockSource[]): { manifest: unknown; from: string } | undefined {
  for (const source of sources) {
    for (const ref of source.atoms) {
      if (ref.kind !== 'connector' && ref.kind !== 'provider') continue
      const manifest = parse(source.folder.files.get(ref.relPath))
      if (isRecord(manifest) && manifest['connection'] === wanted) {
        return { manifest, from: source.label ? `${source.label}/${ref.relPath}` : ref.relPath }
      }
    }
  }
  return undefined
}

/**
 * `FIELD_UNKNOWN` warnings for every `app/surfaces/<key>.receipt.json` of a
 * folder. A receipt that is not JSON is skipped (the pack validation reports it).
 * `connections` ({@link connectionFieldSets}) makes connector-served sources
 * known; a source whose connection is not in it is not checked.
 */
export function checkRowFields(folder: PackFolder, connections: ConnectionFieldSets = new Map()): PackIssue[] {
  const entities = entityFieldSets(folder)
  const issues: PackIssue[] = []
  const receipts = [...folder.files.keys()]
    .filter((p) => p.startsWith(SURFACES) && p.endsWith(RECEIPT_SUFFIX) && !p.slice(SURFACES.length).includes('/'))
    .sort()
  for (const path of receipts) {
    const receipt = parse(folder.files.get(path))
    if (receipt === undefined) continue
    issues.push(...checkReceiptRowFields(receipt, entities, path, path.slice(SURFACES.length, -RECEIPT_SUFFIX.length), connections))
  }
  return issues
}
