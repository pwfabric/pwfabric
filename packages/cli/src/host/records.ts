/**
 * The app's own records, in memory (data-protocol §5).
 *
 * One collection per entity type declared in `app/definitions/entities.json`,
 * seeded on first use from `app/content/` then `app/data/` (see `readSeed`). A
 * record is `{ …fields, id, entityType, createdAt, updatedAt }`, fields spread
 * at the top level like the reference server's.
 *
 * ACCESS is the app's `auth.json` `access.rules` (definitions, `access`):
 *
 *  - `required: true`: every data request needs a session (`401`).
 *  - A model no rule names is open to every visitor.
 *  - A model some rule names is closed: a request passes when a rule whose
 *    subject matches the caller (`public`, `member`, or one of the caller's
 *    roles) grants its verb. `own` limits the grant to the caller's records.
 *  - Refused: `401 SIGN_IN_REQUIRED` without a session, `403 FORBIDDEN` with
 *    one; a record outside an `own` grant is `404`.
 *
 * The development user carries every role `access.roles` declares, so the
 * author can try the app as staff; any other e-mail signs in as a plain member.
 */

import { randomUUID } from 'node:crypto'
import { HostError } from './http.js'
import { readSeed, type AuthDeclaration, type EntityDeclaration } from './definitions.js'
import { aggregate, matches, parseFilter, parseSort, sortRows, type AggregateResult, type Filter, type Row } from './query.js'
import type { Principal } from './tokens.js'

export type Scope = 'project' | 'owner'

type Verb = 'create' | 'list' | 'view' | 'update' | 'delete' | 'count'
/** What one verb allows the caller: nothing, their own records, or every record. */
type Reach = 'none' | 'own' | 'all'
export type Access = Readonly<Record<Verb, Reach>>

const VERBS: Readonly<Record<string, readonly Verb[]>> = {
  create: ['create'],
  list: ['list'],
  view: ['view'],
  update: ['update'],
  delete: ['delete'],
  count: ['count'],
  read: ['list', 'view'],
  write: ['create', 'update', 'delete'],
}
const OPEN: Access = { create: 'all', list: 'all', view: 'all', update: 'all', delete: 'all', count: 'all' }
const RANK: Readonly<Record<Reach, number>> = { none: 0, own: 1, all: 2 }

/** Fields a record names its owner in; a create fills the first one when blank. */
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

/** The words of a rule: verbs and `own`; anything else is ignored. */
export function parseRule(rule: string): { verbs: Verb[]; own: boolean; unknown: string[] } {
  const verbs = new Set<Verb>()
  const unknown: string[] = []
  let own = false
  for (const word of rule.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (word === 'own') own = true
    else if (VERBS[word]) for (const v of VERBS[word]) verbs.add(v)
    else unknown.push(word)
  }
  return { verbs: [...verbs], own, unknown }
}

/** What `caller` (with `roles`) may do with `entity` under the app's rules. */
export function accessOf(
  entity: EntityDeclaration,
  auth: AuthDeclaration | undefined,
  caller: { readonly principal: Principal | undefined; readonly roles: readonly string[] }
): Access {
  const names = new Set([norm(entity.typeId), ...(entity.displayName ? [norm(entity.displayName)] : [])])
  const rules = (auth?.access.rules ?? []).filter((r) => names.has(norm(r.model)))
  if (rules.length === 0) return OPEN
  const access: Record<Verb, Reach> = { create: 'none', list: 'none', view: 'none', update: 'none', delete: 'none', count: 'none' }
  for (const r of rules) {
    const subject = r.subject.trim()
    const applies =
      subject === 'public' || (caller.principal !== undefined && (subject === 'member' || caller.roles.includes(subject)))
    if (!applies) continue
    const { verbs, own } = parseRule(r.rule)
    for (const verb of verbs) {
      // A visitor who is not signed in owns no record; `own` never limits create.
      const reach: Reach = !own || verb === 'create' ? 'all' : caller.principal ? 'own' : 'none'
      if (RANK[reach] > RANK[access[verb]]) access[verb] = reach
    }
  }
  return access
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

  /** What the caller may do here; refuses a caller the app does not let in at all. */
  private access({ entity, auth, caller }: Target): Access {
    if (auth?.required && !caller.principal) {
      throw new HostError(401, 'SIGN_IN_REQUIRED', 'Sign in to use this app.')
    }
    const roles = caller.principal?.id === this.devUser.id ? (auth?.access.roles ?? []) : []
    return accessOf(entity, auth, { principal: caller.principal, roles })
  }

  /** The reach of `verb`, refusing when it is none. */
  private allow(target: Target, verb: Verb, access = this.access(target)): Reach {
    const reach = access[verb]
    if (reach !== 'none') return reach
    const name = target.entity.displayName ?? target.entity.typeId
    if (!target.caller.principal) throw new HostError(401, 'SIGN_IN_REQUIRED', `Sign in to use ${name} records.`)
    throw new HostError(403, 'FORBIDDEN', `You may not ${verb} ${name} records.`)
  }

  /** The rows within `reach`, newest change first, after `filter`. */
  private rows(target: Target, reach: Reach, params: URLSearchParams): Row[] {
    let filter: Filter | undefined
    try {
      filter = parseFilter(params.get('filter'))
    } catch {
      throw new HostError(400, 'INVALID_QUERY', 'filter must be a JSON filter object.')
    }
    const rows = [...this.collection(target.entity).values()]
      .filter((s) => reach === 'all' || s.owner === target.caller.principal?.id)
      .sort((a, b) => b.touched - a.touched)
      .map((s) => s.record)
    return filter ? rows.filter((r) => matches(r, filter)) : rows
  }

  list(target: Target, params: URLSearchParams): ListAnswer {
    const reach = this.allow(target, 'list')
    const rows = this.rows(target, reach, params)
    const sort = parseSort(params.get('sort'))
    const ordered = sort.length > 0 ? sortRows(rows, sort) : rows
    const limitRaw = Number(params.get('limit') ?? '100')
    const offsetRaw = Number(params.get('offset') ?? '0')
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0
    return {
      data: ordered.slice(offset, offset + limit),
      meta: { total: ordered.length, scope: reach === 'own' ? 'owner' : 'project', timestamp: new Date().toISOString() },
    }
  }

  /** `/count` (`plainCount`) or `/aggregate?fn&field`: over every row with `count`, else over the rows `list` reaches. */
  aggregate(target: Target, params: URLSearchParams, plainCount: boolean): AggregateAnswer {
    const fn = plainCount ? 'count' : params.get('fn')
    if (fn !== 'count' && fn !== 'sum' && fn !== 'avg') {
      throw new HostError(400, 'INVALID_QUERY', 'fn must be count, sum or avg.')
    }
    const field = plainCount ? undefined : (params.get('field') ?? undefined)
    if (fn !== 'count' && !field) throw new HostError(400, 'INVALID_QUERY', `${fn} needs a field.`)
    const access = this.access(target)
    const reach = access.count === 'all' ? 'all' : this.allow(target, 'list', access)
    const rows = this.rows(target, reach, params)
    return {
      data: aggregate(rows, fn, field),
      meta: { scope: reach === 'own' ? 'owner' : 'project', timestamp: new Date().toISOString() },
    }
  }

  private find(target: Target, verb: Verb, id: string): Stored {
    const reach = this.allow(target, verb)
    const stored = this.collection(target.entity).get(id)
    if (!stored || (reach === 'own' && stored.owner !== target.caller.principal?.id)) {
      throw new HostError(404, 'NOT_FOUND', `No ${target.entity.typeId} record "${id}".`)
    }
    return stored
  }

  read(target: Target, id: string): Row {
    return this.find(target, 'view', id).record
  }

  create(target: Target, body: Record<string, unknown>): Row {
    const { entity, caller } = target
    this.allow(target, 'create')
    const fields = writable(body)
    const ownerField = ownerFieldOf(entity)
    if (ownerField && isEmpty(fields[ownerField]) && caller.principal) {
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
    const stored = this.find(target, 'update', id)
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
    this.find(target, 'delete', id)
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
