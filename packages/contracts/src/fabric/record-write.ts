/**
 * RECORD WRITE CONTRACT — what a session server does with a create or an
 * update of one of the app's own records (definitions, `entities.json`;
 * data-protocol §5).
 *
 * One pure function, so every server that hosts an app's records — the
 * reference development host (`pwf dev`) and a platform's session server —
 * answers a write the same way:
 *
 *  1. **Envelope members** (`id`, `entityType`, `createdAt`, `updatedAt`) are
 *     the server's and are DROPPED from the body, as they always were.
 *  2. **A field the entity does not declare is refused.**
 *  3. **Server-owned fields** (a field declared with `server`) are the
 *     server's to set:
 *       - `"owner"` — the caller's id on create; never changes after;
 *       - `"createdAt"` — the time of the create; never changes after;
 *       - `"updatedAt"` — the time of every create and update;
 *       - `{ "default": v }` — `v` on create; an update MAY change it (who
 *         may is the access rules), so a status starts as "placed" and staff
 *         move it on.
 *     A body that carries a value for one of them where the server sets it
 *     is REFUSED (not silently dropped): a client that sends `owner` is
 *     either wrong or forging, and both deserve the 400.
 *  4. **Declared types are checked** and a value is stored as its type
 *     (definitions, "Field types"): `text` a string; `number` a finite number
 *     or a decimal numeral; `boolean` true/false or `"true"`/`"false"`,
 *     `"on"`/`"off"`, `"1"`/`"0"`, `1`/`0`; `date` an ISO 8601 date or
 *     date-time; `relation` a record id (a string, or a number written as
 *     one); `enum` one of the field's `values`. A field of another type is
 *     carried unchecked. On a field that is not `text`, a blank string is
 *     no value. `null` is no value.
 *  5. **`required`** fields must have a value on create — not absent, not
 *     `null`, not a blank string (of any type) — and an update may not
 *     clear one.
 *
 * Every refusal is one `VALIDATION_FAILED` whose message lists each problem as
 * `<field>: <reason>`, separated by `; ` — the form highlights those fields.
 * Computed fields (`total = price × qty`) are out of scope.
 *
 * @module @pwfabric/contracts/fabric/record-write
 */

/** The server-owned roles a field may declare. */
export const RECORD_SERVER_ROLES = ['owner', 'createdAt', 'updatedAt'] as const
export type RecordServerRole = (typeof RECORD_SERVER_ROLES)[number]

/** `server` on an entity field: a role, or a default set on create. */
export type RecordServerField = RecordServerRole | { readonly default: unknown }

/** An entity field as a record writer reads it (definitions, `entities.json`). */
export interface RecordFieldDeclaration {
  readonly name: string
  readonly type: string
  readonly required?: boolean
  /** `enum` only: the values the field may hold. */
  readonly values?: readonly string[]
  readonly server?: RecordServerField
}

export interface RecordWriteInput {
  readonly fields: readonly RecordFieldDeclaration[]
  /** The request body: the record itself, or a lone `{ data: { … } }` wrapper. */
  readonly body: Readonly<Record<string, unknown>>
  readonly op: 'create' | 'update'
  /** Who writes: the caller's id, or undefined for a visitor who has not signed in. */
  readonly callerId?: string
  /** The time of the write, ISO 8601. */
  readonly now: string
}

export type RecordWriteResult =
  | {
      readonly ok: true
      /** The fields to store: on create the whole record, on update the change. */
      readonly fields: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly code: 'VALIDATION_FAILED'
      /** `<field>: <reason>; <field>: <reason>` */
      readonly message: string
      /** The fields the message names, in order. */
      readonly fieldNames: readonly string[]
    }

/** The members of a record the server owns whatever the entity declares. */
export const RECORD_ENVELOPE_MEMBERS: ReadonlySet<string> = new Set(['id', 'entityType', 'createdAt', 'updatedAt'])
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const TRUE = new Set(['true', 'on', '1'])
const FALSE = new Set(['false', 'off', '0'])

/** Is `server` a role (or a default) this contract knows? */
export function isRecordServerField(server: unknown): server is RecordServerField {
  if (typeof server === 'string') return (RECORD_SERVER_ROLES as readonly string[]).includes(server)
  return Boolean(server) && typeof server === 'object' && !Array.isArray(server) && 'default' in (server as object)
}

/**
 * A value read as its declared type. `{ value }` when it is one (`undefined`
 * for no value), `{ error }` when it is not.
 */
export function readRecordFieldValue(
  field: Pick<RecordFieldDeclaration, 'type' | 'values'>,
  raw: unknown
): { readonly value: unknown } | { readonly error: string } {
  if (raw === null || raw === undefined) return { value: undefined }
  const blank = typeof raw === 'string' && raw.trim() === ''
  switch (field.type) {
    case 'text':
      return typeof raw === 'string' ? { value: raw } : { error: 'must be text' }
    case 'number': {
      if (blank) return { value: undefined }
      if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { error: 'must be a number' }
      if (typeof raw === 'string' && DECIMAL.test(raw.trim())) return { value: Number(raw.trim()) }
      return { error: 'must be a number' }
    }
    case 'boolean': {
      if (blank) return { value: undefined }
      if (typeof raw === 'boolean') return { value: raw }
      if (raw === 1 || raw === 0) return { value: raw === 1 }
      if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase()
        if (TRUE.has(s)) return { value: true }
        if (FALSE.has(s)) return { value: false }
      }
      return { error: 'must be true or false' }
    }
    case 'date': {
      if (blank) return { value: undefined }
      if (typeof raw === 'string' && ISO_DATE.test(raw.trim()) && !Number.isNaN(Date.parse(raw.trim()))) {
        return { value: raw.trim() }
      }
      return { error: 'must be an ISO 8601 date' }
    }
    case 'relation': {
      if (blank) return { value: undefined }
      if (typeof raw === 'string') return { value: raw.trim() }
      if (typeof raw === 'number' && Number.isFinite(raw)) return { value: String(raw) }
      return { error: 'must be the id of a record' }
    }
    case 'enum': {
      if (blank) return { value: undefined }
      const values = field.values ?? []
      return typeof raw === 'string' && values.includes(raw)
        ? { value: raw }
        : { error: `must be one of ${values.map((v) => JSON.stringify(v)).join(', ')}` }
    }
    default:
      // A type this contract does not define is carried as written.
      return { value: raw }
  }
}

/** The body itself, or what a lone `{ data: { … } }` wrapper holds. */
function unwrap(body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const keys = Object.keys(body)
  const inner = body['data']
  return keys.length === 1 && keys[0] === 'data' && inner && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : body
}

/** Is a server-owned field the server's to set on this write? */
function serverSets(server: RecordServerField, op: 'create' | 'update'): boolean {
  if (typeof server === 'object') return op === 'create'
  return true
}

/** What the server writes into a server-owned field on this write; `undefined` to leave it. */
function serverValue(server: RecordServerField, input: RecordWriteInput): unknown {
  if (typeof server === 'object') return input.op === 'create' ? server.default : undefined
  if (server === 'owner') return input.op === 'create' ? input.callerId : undefined
  if (server === 'createdAt') return input.op === 'create' ? input.now : undefined
  return input.now // updatedAt
}

/** Check a create or an update of one record against its entity's fields (see the module header). */
export function prepareRecordWrite(input: RecordWriteInput): RecordWriteResult {
  const byName = new Map(input.fields.map((f) => [f.name, f]))
  const problems: [string, string][] = []
  const out: Record<string, unknown> = {}

  for (const [name, raw] of Object.entries(unwrap(input.body))) {
    if (RECORD_ENVELOPE_MEMBERS.has(name) || UNSAFE_KEYS.has(name)) continue
    const field = byName.get(name)
    if (!field) {
      problems.push([name, 'is not a field of this record'])
      continue
    }
    if (field.server !== undefined && isRecordServerField(field.server) && serverSets(field.server, input.op)) {
      problems.push([name, 'is set by the server'])
      continue
    }
    const read = readRecordFieldValue(field, raw)
    if ('error' in read) {
      problems.push([name, read.error])
      continue
    }
    if (read.value !== undefined) out[name] = read.value
    else if (input.op === 'update') out[name] = null
  }

  for (const field of input.fields) {
    if (field.server !== undefined && isRecordServerField(field.server)) {
      const value = serverValue(field.server, input)
      if (value !== undefined) out[field.name] = value
      continue
    }
    if (!field.required) continue
    const v = out[field.name]
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
    const missing = input.op === 'create' ? empty : field.name in out && empty
    if (missing && !problems.some(([n]) => n === field.name)) {
      problems.push([field.name, input.op === 'create' ? 'is required' : 'cannot be emptied'])
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: problems.map(([n, why]) => `${n}: ${why}`).join('; '),
      fieldNames: problems.map(([n]) => n),
    }
  }
  return { ok: true, fields: out }
}
