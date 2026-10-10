/**
 * The app's own records, in memory (data-protocol §5).
 *
 * One collection per entity type declared in `app/definitions/entities.json`,
 * seeded on first use from `app/data/` (see `readSeed`). A record is
 * `{ …fields, id, entityType, createdAt, updatedAt }`, fields spread at the
 * top level like the reference server's.
 *
 * ACCESS, read off the declarations — a deliberately small version of what a
 * hosted session server decides:
 *
 *  - `auth.json` `required: true`: every data request needs a session
 *    (`401 SIGN_IN_REQUIRED`).
 *  - A collection is OWNER-SCOPED when an `access.rules[]` entry names it and
 *    is not a public read grant (subject `public`/`anyone`/`visitors`/…, a
 *    rule that grants reading and does not say "own"), when the entity
 *    declares an owner field (`owner`, `ownerId`, `userId`, `createdBy`, …),
 *    or when the entity carries `"scope": "owner"`. An owner-scoped collection
 *    needs a session, lists only the caller's rows, and answers another
 *    visitor's row as `404`.
 *  - Every other collection is shared by the whole app: anyone may read and
 *    write it.
 */

import { randomUUID } from 'node:crypto'
import { HostError } from './http.js'
import { readSeed, type AuthDeclaration, type EntityDeclaration } from './definitions.js'
import { aggregate, matches, parseFilter, parseSort, sortRows, type AggregateResult, type Filter, type Row } from './query.js'
import type { Principal } from './tokens.js'

export type Scope = 'project' | 'owner'

const PUBLIC_SUBJECTS = new Set([
  'public',
  'anyone',
  'anybody',
  'everyone',
  'everybody',
  'all',
  'visitor',
  'visitors',
  'guest',
  'guests',
  'anonymous',
  '*',
])
const READ_VERB = /\b(read|reads|see|sees|view|views|list|lists|browse|browses)\b/i
const OWN_WORD = /\b(own|their|his|her|only)\b/i
const OWNER_FIELDS = new Set([
  'owner',
  'ownerid',
  'createdby',
  'createdbyid',
  'userid',
  'memberid',
  'authorid',
  'principalid',
  'accountid',
])
const RESERVED = new Set(['id', 'entityType', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype'])

const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '')

function ownerFieldOf(entity: EntityDeclaration): string | undefined {
  return entity.fields.find((f) => OWNER_FIELDS.has(norm(f.name)))?.name
}

export function scopeOf(entity: EntityDeclaration, auth: AuthDeclaration | undefined): Scope {
  const names = new Set([norm(entity.typeId), ...(entity.displayName ? [norm(entity.displayName)] : [])])
  const rules = (auth?.access.rules ?? []).filter((r) => names.has(norm(r.model)))
  const publicGrant = rules.some(
    (r) => PUBLIC_SUBJECTS.has(r.subject.trim().toLowerCase()) && READ_VERB.test(r.rule) && !OWN_WORD.test(r.rule)
  )
  if (publicGrant) return 'project'
  if (rules.length > 0 || ownerFieldOf(entity) !== undefined || entity.scope === 'owner') return 'owner'
  return 'project'
}

interface Stored {
  record: Row
  readonly owner: string | undefined
  touched: number
}

export interface Caller {
  readonly principal: Principal | undefined
}

export interface ListAnswer {
  readonly data: Row[]
  readonly meta: { readonly total: number; readonly scope: Scope; readonly timestamp: string }
}

export interface AggregateAnswer {
  readonly data: AggregateResult
  readonly meta: { readonly scope: Scope; readonly timestamp: string }
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''

/** The data the request is about: which collection, under which declaration, for whom. */
export interface Target {
  readonly entity: EntityDeclaration
  readonly auth: AuthDeclaration | undefined
  readonly caller: Caller
}

export class RecordStore {
  private readonly collections = new Map<string, Map<string, Stored>>()
  private clock = 0

  constructor(
    private readonly root: string,
    private readonly devUser: Principal
  ) {}

  reset(): void {
    this.collections.clear()
    this.clock = 0
  }

  private collection(entity: EntityDeclaration): Map<string, Stored> {
    let rows = this.collections.get(entity.typeId)
    if (rows) return rows
    rows = new Map()
    const now = new Date().toISOString()
    const ownerField = ownerFieldOf(entity)
    for (const seed of readSeed(this.root, entity.typeId)) {
      const id = typeof seed.id === 'string' || typeof seed.id === 'number' ? String(seed.id) : randomUUID()
      const declaredOwner = ownerField ? seed[ownerField] : undefined
      rows.set(id, {
        record: {
          ...seed,
          id,
          entityType: entity.typeId,
          createdAt: typeof seed.createdAt === 'string' ? seed.createdAt : now,
          updatedAt: typeof seed.updatedAt === 'string' ? seed.updatedAt : now,
        },
        // Seed rows belong to the development user unless they name an owner.
        owner: typeof declaredOwner === 'string' && declaredOwner ? declaredOwner : this.devUser.id,
        touched: ++this.clock,
      })
    }
    this.collections.set(entity.typeId, rows)
    return rows
  }

  /** Refuses a caller the declarations do not let in; answers the collection's scope. */
  private guard({ entity, auth, caller }: Target): Scope {
    if (auth?.required && !caller.principal) {
      throw new HostError(401, 'SIGN_IN_REQUIRED', 'Sign in to use this app.')
    }
    const scope = scopeOf(entity, auth)
    if (scope === 'owner' && !caller.principal) {
      throw new HostError(401, 'SIGN_IN_REQUIRED', `Sign in to see your ${entity.displayName ?? entity.typeId} records.`)
    }
    return scope
  }

  /** The rows this caller may see, newest change first, after `filter`. */
  private visible(target: Target, params: URLSearchParams): { scope: Scope; rows: Row[] } {
    const scope = this.guard(target)
    let filter: Filter | undefined
    try {
      filter = parseFilter(params.get('filter'))
    } catch {
      throw new HostError(400, 'INVALID_QUERY', 'filter must be a JSON filter object.')
    }
    const rows = [...this.collection(target.entity).values()]
      .filter((s) => scope === 'project' || s.owner === target.caller.principal?.id)
      .sort((a, b) => b.touched - a.touched)
      .map((s) => s.record)
    return { scope, rows: filter ? rows.filter((r) => matches(r, filter)) : rows }
  }

  list(target: Target, params: URLSearchParams): ListAnswer {
    const { scope, rows } = this.visible(target, params)
    const sort = parseSort(params.get('sort'))
    const ordered = sort.length > 0 ? sortRows(rows, sort) : rows
    const limitRaw = Number(params.get('limit') ?? '100')
    const offsetRaw = Number(params.get('offset') ?? '0')
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0
    return {
      data: ordered.slice(offset, offset + limit),
      meta: { total: ordered.length, scope, timestamp: new Date().toISOString() },
    }
  }

  /** `/count` (`plainCount`) or `/aggregate?fn&field`. */
  aggregate(target: Target, params: URLSearchParams, plainCount: boolean): AggregateAnswer {
    const fn = plainCount ? 'count' : params.get('fn')
    if (fn !== 'count' && fn !== 'sum' && fn !== 'avg') {
      throw new HostError(400, 'INVALID_QUERY', 'fn must be count, sum or avg.')
    }
    const field = plainCount ? undefined : (params.get('field') ?? undefined)
    if (fn !== 'count' && !field) throw new HostError(400, 'INVALID_QUERY', `${fn} needs a field.`)
    const { scope, rows } = this.visible(target, params)
    return { data: aggregate(rows, fn, field), meta: { scope, timestamp: new Date().toISOString() } }
  }

  private find(target: Target, id: string): Stored {
    const scope = this.guard(target)
    const stored = this.collection(target.entity).get(id)
    if (!stored || (scope === 'owner' && stored.owner !== target.caller.principal?.id)) {
      throw new HostError(404, 'NOT_FOUND', `No ${target.entity.typeId} record "${id}".`)
    }
    return stored
  }

  read(target: Target, id: string): Row {
    return this.find(target, id).record
  }

  create(target: Target, body: Record<string, unknown>): Row {
    const { entity, caller } = target
    const scope = this.guard(target)
    const fields = writable(body)
    const ownerField = ownerFieldOf(entity)
    if (scope === 'owner' && ownerField && isEmpty(fields[ownerField]) && caller.principal) {
      fields[ownerField] = caller.principal.id
    }
    const missing = entity.fields.filter((f) => f.required && isEmpty(fields[f.name])).map((f) => f.name)
    if (missing.length > 0) {
      throw new HostError(400, 'VALIDATION_FAILED', `Missing required field(s): ${missing.join(', ')}.`)
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    const record: Row = { ...fields, id, entityType: entity.typeId, createdAt: now, updatedAt: now }
    this.collection(entity).set(id, { record, owner: caller.principal?.id, touched: ++this.clock })
    return record
  }

  update(target: Target, id: string, body: Record<string, unknown>): Row {
    const stored = this.find(target, id)
    const fields = writable(body)
    const cleared = target.entity.fields
      .filter((f) => f.required && f.name in fields && isEmpty(fields[f.name]))
      .map((f) => f.name)
    if (cleared.length > 0) {
      throw new HostError(400, 'VALIDATION_FAILED', `Required field(s) cannot be empty: ${cleared.join(', ')}.`)
    }
    stored.record = {
      ...stored.record,
      ...fields,
      id,
      entityType: target.entity.typeId,
      updatedAt: new Date().toISOString(),
    }
    stored.touched = ++this.clock
    return stored.record
  }

  remove(target: Target, id: string): void {
    this.find(target, id)
    this.collection(target.entity).delete(id)
  }
}

/** The record itself is the body; a lone `{ data: { … } }` wrapper is unwrapped. Server-owned members are dropped. */
function writable(body: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(body)
  const inner = body.data
  const source =
    keys.length === 1 && keys[0] === 'data' && inner && typeof inner === 'object' && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : body
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    if (!RESERVED.has(k)) out[k] = v
  }
  return out
}
