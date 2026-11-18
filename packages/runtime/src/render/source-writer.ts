/**
 * SOURCE WRITER — the one place that knows how a record is written to a source.
 *
 * Two callers write records: a form binding (`platform/entities`
 * `formBindings`, data-protocol §4) and the `write` action (§1.2). Both name
 * a SOURCE, never a backend, and this decides what the source means:
 *
 *  - an `entity` source with an entity facade writes through the facade's
 *    store (create, update, delete);
 *  - any other source writes over HTTP through the data layer — `POST
 *    <endpoint>` to create, `PATCH <endpoint>/<id>` (or the form's `PUT`) to
 *    update, `DELETE <endpoint>/<id>` to delete — with the source's own
 *    headers and credential.
 *
 * Who may write is the server's to decide: the access rules are enforced by
 * whoever serves the records (the record host answers 401/403), and a refusal
 * comes back as a failed result like any other.
 *
 * @module @pwfabric/runtime/render/source-writer
 */

import type { DataServiceInterface } from '../data/types.js'
import type { EntityFacade } from '../entity/facade.js'
import type { EntityMutationResult } from '../entity/types.js'
import { toFormWriteError } from '../forms/form-write-target.js'
import type { SurfaceDataSourceDefinition } from './data-binding-types.js'

/** What a write does to the record. */
export type RecordWriteOp = 'create' | 'update' | 'delete'

export interface RecordWrite {
  readonly op: RecordWriteOp
  /** The record an update or a delete names. */
  readonly id?: string
  /** The fields a create or an update sends. */
  readonly values?: Readonly<Record<string, unknown>>
  /** The HTTP verb of an update (`PATCH` unless a form binding says `PUT`). */
  readonly updateMethod?: 'PUT' | 'PATCH'
}

export type SourceWriter = (sourceId: string, write: RecordWrite) => Promise<EntityMutationResult>

const refused = (type: 'not_found' | 'connector' | 'validation', detail: string): EntityMutationResult => ({
  success: false,
  // The reason code is decided by the caller (writeFailureReason);
  // the detail is for the author.
  error: { type, message: detail, details: { detail } },
})

/**
 * ONLY THE RECORD'S FIELDS ARE SENT, EACH AS ITS TYPE (data-protocol §4.1).
 *
 * A form gathers every named control, and some are the page's own: a one-time
 * code, a "confirm e-mail" box, a step counter. Sent, the server refused the
 * whole write ("code: is not a field of this record", 400), so an app had to
 * declare a helper as a field of its model. And a form gathers strings, as an
 * HTML form does: a slider's `"10"` for a number field, a checkbox's `"on"`.
 * A source that knows its fields (`fields`, name → declared type, written by
 * the host from the app's entity declaration) sends those, converted; the
 * rest stay on the page. A source that does not know them sends what the form
 * named, as gathered.
 */
function recordFieldsOf(
  values: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, string>> | undefined
): Record<string, unknown> {
  if (!fields) return { ...values }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue
    out[k] = asFieldType(fields[k] as string, v)
  }
  return out
}

/** A gathered value as the field's declared type; a value it cannot be is sent as it is, for the server to refuse. */
function asFieldType(type: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  switch (type) {
    case 'number': {
      if (text === '') return null
      const n = Number(text)
      return Number.isFinite(n) ? n : value
    }
    case 'boolean': {
      const t = text.toLowerCase()
      if (t === 'true' || t === 'on' || t === '1') return true
      if (t === 'false' || t === 'off' || t === '0' || t === '') return false
      return value
    }
    default:
      return value
  }
}

/**
 * A FILE IS NOT A FIELD VALUE. A file control inside a bound form handed the
 * write a `File`, which JSON writes as `{}`: every save failed while a file
 * was chosen, and nothing said why. Refused here with the field named; a file
 * goes through an upload (media), and the record stores what it answered.
 */
function fileFieldOf(values: Readonly<Record<string, unknown>>): string | undefined {
  const isFile = (v: unknown): boolean =>
    (typeof Blob !== 'undefined' && v instanceof Blob) ||
    (typeof FileList !== 'undefined' && v instanceof FileList) ||
    (Array.isArray(v) && v.some(isFile))
  return Object.keys(values).find((k) => isFile(values[k]))
}

export function createSourceWriter(deps: {
  readonly dataSources: readonly SurfaceDataSourceDefinition[] | undefined
  readonly entityFacade: EntityFacade | null | undefined
  readonly dataService: DataServiceInterface | null | undefined
}): SourceWriter {
  const byId = new Map((deps.dataSources ?? []).map((s) => [s.id, s]))
  return async (sourceId, write) => {
    const source = byId.get(sourceId)
    const file = fileFieldOf(write.values ?? {})
    if (file !== undefined) {
      return refused(
        'validation',
        `"${file}" holds a file. A record stores values, not files: upload the file first and write what the upload answered.`
      )
    }
    const values = recordFieldsOf(write.values ?? {}, source?.fields)
    if ((write.op === 'update' || write.op === 'delete') && !write.id) {
      return refused('validation', `A ${write.op} of "${sourceId}" names no record id.`)
    }
    const { entityFacade, dataService } = deps
    if (source?.kind === 'entity' && source.entityType && entityFacade) {
      const entityType = source.entityType as never
      if (write.op === 'create') return entityFacade.store.create(entityType, values)
      if (write.op === 'update') return entityFacade.store.update(entityType, write.id as never, values)
      return entityFacade.store.delete(entityType, write.id as never)
    }
    if (!source) {
      return refused('not_found', `This page writes to "${sourceId}", which it does not declare.`)
    }
    if (!dataService) {
      return refused('connector', `This page writes to "${sourceId}", but has no data layer to write through.`)
    }
    const method = write.op === 'create' ? 'POST' : write.op === 'delete' ? 'DELETE' : (write.updateMethod ?? 'PATCH')
    const res = await dataService.fetchData(sourceId, {
      method,
      ...(write.op === 'delete' ? {} : { body: values }),
      ...(write.id !== undefined && write.op !== 'create' ? { recordId: write.id } : {}),
    })
    if (!res.success) return { success: false, error: toFormWriteError(res.error) }
    // A record answer is `{ data: Record }` (data-protocol §5.3): a source
    // with `returns` has had it plucked already; without one a lone `data`
    // wrapper is unwrapped here, and a bare record is accepted too.
    const body = res.data as Record<string, unknown> | null
    const wrapped = source.returns === undefined && body && typeof body === 'object' && !Array.isArray(body)
    const inner = wrapped && body['data'] && typeof body['data'] === 'object' ? body['data'] : body
    const written = (inner ?? {}) as Record<string, unknown>
    const id = written['id']
    return {
      success: true,
      data: written as never,
      id: (typeof id === 'string' || typeof id === 'number' ? String(id) : (write.id ?? sourceId)) as never,
    }
  }
}
