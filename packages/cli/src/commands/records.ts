/**
 * `pwf records import <type> <file>` and `pwf records export <type>` — the
 * records an app ships, `app/content/<type>.json` (data-protocol §6.1),
 * typed by `app/definitions/entities.json`.
 *
 * Import reads CSV (RFC 4180, a header row naming the fields) or JSON (a
 * list of records, or `{ data: [...] }`), checks every record against its
 * entity — no undeclared field, each value of its field's type (a CSV cell
 * is read as the type says: `12.5` for a number, `true`/`false` for a
 * boolean), every required field set, a UUID `id` (one is made when
 * absent), no id twice — and writes all of them or none. Without
 * `--replace` the records join the file's, an id it has already replacing
 * that record.
 *
 * Export writes them as JSON or CSV; a CSV text cell that a spreadsheet
 * would run as a formula is written with a leading `'`.
 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { readRecordFieldValue, RECORD_ENVELOPE_MEMBERS } from '@pwfabric/contracts/record-write'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { formatJson, stripBom } from './lib/identity.js'
import { resolveFrom } from './lib/project.js'
import { isObject, readAppIdentity, readJsonObject, writeJsonFile, type JsonObject } from './lib/app-files.js'
import { parseCsv, unguard, writeCsv } from './lib/csv.js'
import { entityDeclarationsOf, type EntityDeclaration, type EntityField } from '../host/definitions.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITIES_FILE = 'app/definitions/entities.json'
const contentRel = (type: string): string => `app/content/${type}.json`

async function entityOf(root: string, type: string): Promise<EntityDeclaration> {
  await readAppIdentity(root, 'pwf records')
  const entities = entityDeclarationsOf(await readJsonObject(root, ENTITIES_FILE))
  const entity = entities.find((e) => e.typeId === type)
  if (!entity) {
    throw new CommandFailure(
      'ENTITY_UNDECLARED',
      entities.length === 0 ? `${ENTITIES_FILE} declares no entities; declare ${type} there first` : `${type} is not an entity of ${ENTITIES_FILE} (it declares ${entities.map((e) => e.typeId).join(', ')})`
    )
  }
  return entity
}

/** A CSV cell as its field's JSON value: absent when empty; a number, a boolean or text as the type says. */
function cellValue(field: EntityField | undefined, cell: string): unknown {
  if (cell === '') return undefined
  if (field?.type === 'number') return /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell.trim()) ? Number(cell) : cell
  if (field?.type === 'boolean') return cell === 'true' ? true : cell === 'false' ? false : cell
  return unguard(cell)
}

/** The incoming records, as objects. */
function readIncoming(text: string, format: 'csv' | 'json', entity: EntityDeclaration): JsonObject[] {
  if (format === 'json') {
    let value: unknown
    try {
      value = JSON.parse(stripBom(text))
    } catch (e) {
      throw new CommandFailure('RECORDS_INVALID', `the file is not JSON: ${(e as Error).message}`)
    }
    const list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value['data']) ? value['data'] : null
    if (!list) throw new CommandFailure('RECORDS_INVALID', 'the JSON file is not a list of records, nor { "data": [ … ] }')
    return list.map((r, i) => {
      if (!isObject(r)) throw new CommandFailure('RECORDS_INVALID', `record ${i + 1} is not an object`)
      return r
    })
  }
  let rows: string[][]
  try {
    rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''))
  } catch (e) {
    throw new CommandFailure('RECORDS_INVALID', `the CSV does not parse: ${(e as Error).message}`)
  }
  const [header, ...body] = rows
  if (!header) throw new CommandFailure('RECORDS_INVALID', 'the CSV has no header row')
  const byName = new Map(entity.fields.map((f) => [f.name, f]))
  const names = header.map((h) => h.trim())
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup !== undefined) throw new CommandFailure('RECORDS_INVALID', `the header names "${dup}" twice`)
  return body.map((cells, i) => {
    if (cells.length !== names.length) throw new CommandFailure('RECORDS_INVALID', `row ${i + 2} has ${cells.length} fields; the header has ${names.length}`)
    const record: JsonObject = {}
    names.forEach((name, j) => {
      const v = cellValue(byName.get(name), cells[j] as string)
      if (v !== undefined) record[name] = v
    })
    return record
  })
}

/** Checks one record against its entity; the problems as `<field>: <reason>`. */
function checkRecord(record: JsonObject, entity: EntityDeclaration): { value: JsonObject; problems: string[] } {
  const byName = new Map(entity.fields.map((f) => [f.name, f]))
  const problems: string[] = []
  const value: JsonObject = {}
  for (const [name, raw] of Object.entries(record)) {
    if (name === 'id') continue
    if (RECORD_ENVELOPE_MEMBERS.has(name)) {
      if (name === 'entityType') continue
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) problems.push(`${name}: must be an ISO 8601 date`)
      else value[name] = raw
      continue
    }
    const field = byName.get(name)
    if (!field) {
      problems.push(`${name}: is not a field of ${entity.typeId}`)
      continue
    }
    const read = readRecordFieldValue(field, raw)
    if ('error' in read) problems.push(`${name}: ${read.error}`)
    else if (read.value !== undefined) {
      if (field.mustBe !== undefined && read.value !== field.mustBe) problems.push(`${name}: must be ${JSON.stringify(field.mustBe)}`)
      else value[name] = read.value
    }
  }
  for (const f of entity.fields) if (f.required && f.server === undefined && value[f.name] === undefined && !problems.some((p) => p.startsWith(`${f.name}:`))) problems.push(`${f.name}: is required`)
  return { value, problems }
}

export interface Imported {
  readonly type: string
  readonly file: string
  readonly added: number
  readonly replaced: number
  readonly kept: number
}

export async function importRecords(root: string, type: string, path: string, options: { replace: boolean; format?: 'csv' | 'json' }): Promise<Imported> {
  const entity = await entityOf(root, type)
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) throw new CommandFailure('RECORDS_SOURCE_MISSING', `no such file: ${path}`)
  const format = options.format ?? (extname(path).toLowerCase() === '.csv' ? 'csv' : 'json')
  const incoming = readIncoming(text, format, entity)
  const problems: string[] = []
  const records: JsonObject[] = []
  const ids = new Set<string>()
  incoming.forEach((r, i) => {
    const at = format === 'csv' ? `row ${i + 2}` : `record ${i + 1}`
    let id = r['id']
    if (id === undefined || id === '') id = randomUUID()
    if (typeof id !== 'string' || !UUID.test(id)) {
      problems.push(`${at}: id: must be a UUID (content records keep their id once published)`)
      return
    }
    if (ids.has(id)) problems.push(`${at}: id: ${id} is given twice`)
    ids.add(id)
    const checked = checkRecord(r, entity)
    for (const p of checked.problems) problems.push(`${at}: ${p}`)
    records.push({ id, ...checked.value })
  })
  if (problems.length > 0) {
    throw new CommandFailure('RECORDS_INVALID', `nothing imported`, {
      lines: [`pwf records: ${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing was imported:`, ...problems.slice(0, 50).map((p) => `  ${p}`), ...(problems.length > 50 ? [`  … and ${problems.length - 50} more`] : [])],
    })
  }
  const rel = contentRel(type)
  const existing = options.replace ? [] : await currentRecords(root, type)
  let replaced = 0
  const merged = existing.map((r) => {
    const next = records.find((n) => n['id'] === r['id'])
    if (!next) return r
    replaced++
    return next
  })
  const known = new Set(existing.map((r) => r['id']))
  const added = records.filter((r) => !known.has(r['id']))
  await writeJsonFile(root, rel, { data: [...merged, ...added] })
  return { type, file: rel, added: added.length, replaced, kept: existing.length - replaced }
}

async function currentRecords(root: string, type: string): Promise<JsonObject[]> {
  const doc = await readJsonObject(root, contentRel(type))
  if (!doc) return []
  if (!Array.isArray(doc['data'])) throw new CommandFailure('APP_CONTENT_INVALID', `${contentRel(type)} is not { "data": [ … ] }; fix it or import with --replace`)
  return doc['data'].filter(isObject)
}

/** The records of `type` as CSV (a header of id, every declared field, then createdAt/updatedAt when any record has them) or JSON. */
export async function exportRecords(root: string, type: string, format: 'csv' | 'json'): Promise<{ text: string; count: number }> {
  const entity = await entityOf(root, type)
  const records = await currentRecords(root, type)
  if (format === 'json') return { text: formatJson({ data: records }), count: records.length }
  const header = ['id', ...entity.fields.map((f) => f.name), ...['createdAt', 'updatedAt'].filter((k) => records.some((r) => r[k] !== undefined))]
  const extra = [...new Set(records.flatMap((r) => Object.keys(r)))].filter((k) => !header.includes(k) && k !== 'entityType')
  header.push(...extra)
  const rows: string[][] = []
  const isText: boolean[][] = []
  for (const r of records) {
    const row: string[] = []
    const textRow: boolean[] = []
    for (const k of header) {
      const v = r[k]
      if (v === undefined || v === null) {
        row.push('')
        textRow.push(false)
      } else if (typeof v === 'string') {
        row.push(v)
        textRow.push(true)
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        row.push(String(v))
        textRow.push(false)
      } else {
        row.push(JSON.stringify(v))
        textRow.push(true)
      }
    }
    rows.push(row)
    isText.push(textRow)
  }
  return { text: writeCsv(header, rows, isText), count: records.length }
}

function formatFlag(args: ParsedArgs): 'csv' | 'json' | undefined {
  const f = stringFlag(args, 'format')
  if (f === undefined) return undefined
  if (f !== 'csv' && f !== 'json') throw new UsageError(`--format takes csv or json (not "${f}")`)
  return f
}

export async function runRecords(args: ParsedArgs, io: CommandIO): Promise<number> {
  const [verb, type, file, extra] = args.positionals
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  if (verb === 'import') {
    if (type === undefined || file === undefined) throw new UsageError('give the entity type and the file: pwf records import <type> <file.csv|json>')
    if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}"`)
    const format = formatFlag(args)
    const r = await importRecords(root, type, resolveFrom(io.cwd, file), { replace: boolFlag(args, 'replace'), ...(format ? { format } : {}) })
    io.out(`Imported ${r.added + r.replaced} ${type} record${r.added + r.replaced === 1 ? '' : 's'} into ${r.file}: ${r.added} new, ${r.replaced} replaced, ${r.kept} kept`)
    return 0
  }
  if (verb === 'export') {
    if (type === undefined) throw new UsageError('give the entity type: pwf records export <type>')
    if (file !== undefined) throw new UsageError(`unexpected argument "${file}"`)
    const outFlag = stringFlag(args, 'out')
    const format = formatFlag(args) ?? (outFlag && extname(outFlag).toLowerCase() === '.csv' ? 'csv' : 'json')
    const r = await exportRecords(root, type, format)
    if (outFlag) {
      await writeFile(resolveFrom(io.cwd, outFlag), r.text)
      io.out(`Exported ${r.count} ${type} record${r.count === 1 ? '' : 's'} to ${outFlag}`)
    } else {
      io.out(r.text.replace(/\r?\n$/, ''))
    }
    return 0
  }
  throw new UsageError(verb === undefined ? 'missing "import" or "export"' : `unknown subcommand "${verb}"`)
}

export const records: Command = {
  name: 'records',
  summary: "Import or export the records an app ships (app/content), checked against its entities",
  usage: `pwf records import <type> <file.csv|file.json> [--replace] [--format csv|json] [--dir <app>]
pwf records export <type> [--format csv|json] [--out <file>] [--dir <app>]

  <type>          an entity's typeId in app/definitions/entities.json
  --replace       import: the file's records replace all of app/content/<type>.json
                  (default: they join them; a record with an id the file has
                  already replaces that record)
  --format        csv or json (default: by the file's extension; export: json)
  --out <file>    export: write to a file instead of printing

The records are the app's content, app/content/<type>.json ({ "data": [ … ] },
data-protocol §6.1). Import reads CSV (RFC 4180: a header row naming the
fields, "…" quoting, "" for a quote) or JSON (a list, or { "data": [ … ] }),
and checks every record against its entity as a session server would: no
field the entity does not declare, each value of its field's type (a CSV
cell becomes a number or a boolean when the field is one; an empty cell is no
value), required fields set, an id that is a UUID (one is made when absent)
and given once. One problem and nothing is written; each is listed with its
row. Export writes id, every declared field and createdAt/updatedAt; a CSV
text cell starting with =, +, -, @, a tab or a carriage return gets a
leading ' so a spreadsheet does not run it (import takes the ' off again).`,
  run: (args, io) => guard('records', io, () => runRecords(args, io)),
}
