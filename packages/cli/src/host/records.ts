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
 *  - With no rule at all, every model is open to every visitor; once the app
 *    declares a rule, a model no rule names is closed.
 *  - A `count` grant answers the plain, unfiltered `/count` only.
 *  - A model some rule names is closed: a request passes when a rule whose
 *    subject matches the caller (`public`, `member`, or one of the caller's
 *    roles) grants its verb. `own` limits the grant to the caller's records.
 *  - Refused: `401 SIGN_IN_REQUIRED` without a session, `403 FORBIDDEN` with
 *    one; a record outside an `own` grant is `404`.
 *
 * The development user carries every role `access.roles` declares, so the
 * author can try the app as staff; any other e-mail signs in as a plain member.
 *
 * WRITES follow the record write contract (`prepareRecordWrite` in
 * `@pwfabric/contracts`, definitions "Server-owned fields"): a field the
 * entity does not declare is refused, declared types are checked, and the
 * fields declared `server` are set here — a client value for one is refused.
 */

import { randomUUID } from 'node:crypto'
import { HostError } from './http.js'
import { prepareRecordWrite } from '@pwfabric/contracts'
import { readEntities, readSeed, type AuthDeclaration, type EntityDeclaration } from './definitions.js'
import { aggregate, matches, parseFilter, parseSort, sortRows, type AggregateResult, type Filter, type Row } from './query.js'
import type { Principal } from './tokens.js'

export type Scope = 'project' | 'owner'

/** The verbs a rule grants (`read` and `write` expand to these). */
export type AccessVerb = 'create' | 'list' | 'view' | 'update' | 'delete' | 'count'
/** What one verb allows the caller: nothing, their own records, or every record. */
export type AccessReach = 'none' | 'own' | 'all'
type Verb = AccessVerb
type Reach = AccessReach
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
const CLOSED: Access = { create: 'none', list: 'none', view: 'none', update: 'none', delete: 'none', count: 'none' }
const RANK: Readonly<Record<Reach, number>> = { none: 0, own: 1, all: 2 }

const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '')

/** The field a record names its owner in: the one declared `server: "owner"`. */
function ownerFieldOf(entity: EntityDeclaration): string | undefined {
  return entity.fields.find((f) => f.server === 'owner')?.name
}

/** Run a write through the contract; a refusal is the host's `400 VALIDATION_FAILED`. */
function prepared(
  entity: EntityDeclaration,
  body: Record<string, unknown>,
  op: 'create' | 'update',
  caller: Caller,
  now: string,
  relationReadable?: (targetTypeId: string, id: string) => boolean
): Record<string, unknown> {
  const result = prepareRecordWrite({
    fields: entity.fields,
    body,
    op,
    ...(caller.principal ? { callerId: caller.principal.id } : {}),
    ...(caller.principal ? { callerName: caller.principal.displayName || caller.principal.email } : {}),
    now,
    ...(relationReadable ? { relationReadable } : {}),
  })
  if (!result.ok) throw new HostError(400, result.code, result.message)
  return result.fields
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

/**
 * What `caller` (with `roles`) may do with `entity` under the app's rules.
 *
 * An app that declares no access rule at all leaves every model open. Once it
 * declares one, a model no rule names is closed: nobody listed it, so nobody
 * was granted it (a collection only a receipt reads must be named to be read).
 */
export function accessOf(
  entity: EntityDeclaration,
  auth: AuthDeclaration | undefined,
  caller: { readonly principal: Principal | undefined; readonly roles: readonly string[] }
): Access {
  const names = new Set([norm(entity.typeId), ...(entity.displayName ? [norm(entity.displayName)] : [])])
  const declared = auth?.access.rules ?? []
  if (declared.length === 0) return OPEN
  const rules = declared.filter((r) => names.has(norm(r.model)))
  if (rules.length === 0) return CLOSED
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

/** The data the request is about: which collection, under which declaration, for whom. */
export interface Target {
  readonly entity: EntityDeclaration
  readonly auth: AuthDeclaration | undefined
  readonly caller: Caller
}

export class RecordStore {
  private readonly collections = new Map<string, Map<string, Stored>>()

  constructor(
    private readonly root: string,
    private readonly devUser: Principal
  ) {}

  reset(): void {
    this.collections.clear()
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

  /**
   * The rows within `reach`, after `filter`, IN FILE ORDER: the seed's order,
   * then records in the order they were created. An update keeps a record
   * where it is. Newest-change-first reversed every seeded list (a menu, a
   * timeline) the moment it was served, and a list's order is the source's
   * `query.sort` to state, not the host's to invent.
   */
  private rows(target: Target, reach: Reach, params: URLSearchParams): Row[] {
    let filter: Filter | undefined
    try {
      filter = parseFilter(params.get('filter'))
    } catch {
      throw new HostError(400, 'INVALID_QUERY', 'filter must be a JSON filter object.')
    }
    const rows = [...this.collection(target.entity).values()]
      .filter((s) => reach === 'all' || s.owner === target.caller.principal?.id)
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

  /**
   * `/count` (`plainCount`) or `/aggregate?fn&field`, over the rows `list`
   * reaches. A caller whose only grant is `count` gets the plain, unfiltered
   * count over every row and nothing more: a filter or a sum would read field
   * values out of rows they may not list, one number at a time.
   */
  aggregate(target: Target, params: URLSearchParams, plainCount: boolean): AggregateAnswer {
    const fn = plainCount ? 'count' : params.get('fn')
    if (fn !== 'count' && fn !== 'sum' && fn !== 'avg') {
      throw new HostError(400, 'INVALID_QUERY', 'fn must be count, sum or avg.')
    }
    const field = plainCount ? undefined : (params.get('field') ?? undefined)
    if (fn !== 'count' && !field) throw new HostError(400, 'INVALID_QUERY', `${fn} needs a field.`)
    const access = this.access(target)
    const bare = plainCount && params.get('filter') === null
    const reach = bare && access.count === 'all' ? 'all' : this.allow(target, 'list', access)
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

  /**
   * RELATIONS POINT AT A RECORD THE CALLER CAN READ. The target exists and the
   * caller's `view` reach covers it — an owner-scoped target is therefore one
   * of the caller's own: a member could attach a courier note to another
   * account's order (201).
   */
  private relationReadable(target: Target): (targetTypeId: string, id: string) => boolean {
    return (targetTypeId, id) => {
      const entity = readEntities(this.root).find((e) => e.typeId === targetTypeId)
      if (!entity) return false
      try {
        this.find({ ...target, entity }, 'view', id)
        return true
      } catch {
        return false
      }
    }
  }

  /**
   * UNIQUE KEYS. An entity's `unique` lists field-name sets no two records may
   * share (`[["owner", "sessionId"]]`: one reply per person and session). A
   * write that would make a second is refused with 409 `CONFLICT`. A key any
   * of whose fields the record leaves empty constrains nothing.
   */
  private checkUnique(entity: EntityDeclaration, record: Row, owner: string | undefined, selfId?: string): void {
    for (const key of entity.unique ?? []) {
      const valueOf = (r: Row, o: string | undefined, f: string): unknown =>
        r[f] !== undefined ? r[f] : f === ownerFieldOf(entity) ? o : undefined
      const mine = key.map((f) => valueOf(record, owner, f))
      if (mine.some((v) => v === undefined || v === null || v === '')) continue
      for (const [id, other] of this.collection(entity)) {
        if (id === selfId) continue
        if (key.every((f, i) => valueOf(other.record, other.owner, f) === mine[i])) {
          throw new HostError(409, 'CONFLICT', `A ${entity.typeId} record with this ${key.join(' and ')} already exists.`)
        }
      }
    }
  }

  create(target: Target, body: Record<string, unknown>): Row {
    const { entity, caller } = target
    this.allow(target, 'create')
    const now = new Date().toISOString()
    const fields = prepared(entity, body, 'create', caller, now, this.relationReadable(target))
    const id = randomUUID()
    const record: Row = { ...fields, id, entityType: entity.typeId, createdAt: now, updatedAt: now }
    this.checkUnique(entity, record, caller.principal?.id)
    this.collection(entity).set(id, { record, owner: caller.principal?.id })
    return record
  }

  update(target: Target, id: string, body: Record<string, unknown>): Row {
    const stored = this.find(target, 'update', id)
    const now = new Date().toISOString()
    const fields = prepared(target.entity, body, 'update', target.caller, now, this.relationReadable(target))
    this.checkUnique(target.entity, { ...stored.record, ...fields }, stored.owner, id)
    stored.record = {
      ...stored.record,
      ...fields,
      id,
      entityType: target.entity.typeId,
      updatedAt: now,
    }
    return stored.record
  }

  remove(target: Target, id: string): void {
    this.find(target, 'delete', id)
    this.collection(target.entity).delete(id)
  }
}
