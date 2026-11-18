/**
 * THE SOURCES ONLY A SESSION CAN BE ANSWERED FOR, MARKED ON THE SOURCE.
 *
 * conference-companion `#/today` read the visitor's RSVPs (`Rsvp`: `member`
 * `read own`) and headphone-shop's product page the cart (`CartLine`, the
 * same). Signed out, the record host can only refuse those reads — `401
 * SIGN_IN_REQUIRED` (records.ts) — and every signed-out visit printed that
 * 401 in the console, which cost each page its best-practices score. The
 * browser cannot know it: the access rules (`app/definitions/auth.json`
 * `access`) are not in the envelope. So the build reads them and writes
 * `requiresSession: true` (data-protocol §2.6) onto every own-records
 * `entity` source a visitor who is not signed in cannot read, and the
 * runtime, signed out, settles it as that refusal without asking.
 *
 * "Cannot read" is the record host's own decision (`accessOf` with no
 * caller), so the build and the host never disagree:
 *  - an app that requires sign-in: every own-records source;
 *  - otherwise a source whose `list` reach is none for a signed-out caller —
 *    no `public` rule grants it, or only `own` (a visitor who is not signed
 *    in owns no record); a plain, unfiltered `count` aggregate is readable
 *    with a `count` grant alone.
 *
 * Own records only: an `entity` source with no `connector`, of a type the app
 * declares. A source that already states `requiresSession` keeps it. Every
 * later rewrite of the source (the record host's, the runner's) carries the
 * member along.
 *
 * @module @pwfabric/cli/host/session-sources
 */

import type { AuthDeclaration, EntityDeclaration } from './definitions.js'
import { accessOf } from './records.js'

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const NOBODY = { principal: undefined, roles: [] } as const

/** Whether a visitor who is not signed in may read what `source` asks for. */
function readableSignedOut(source: Json, entity: EntityDeclaration, auth: AuthDeclaration | undefined): boolean {
  if (auth?.required) return false
  const access = accessOf(entity, auth, NOBODY)
  const aggregate = isObject(source.aggregate) ? source.aggregate : undefined
  const plainCount =
    aggregate !== undefined &&
    (aggregate.fn === undefined || aggregate.fn === 'count') &&
    aggregate.field === undefined &&
    aggregate.filter === undefined
  if (plainCount && access.count === 'all') return true
  return access.list !== 'none'
}

/** `receipt` with `requiresSession` on its own-records sources a signed-out visitor cannot read, or the same object. */
export function withSessionSources(
  receipt: Json,
  entities: readonly EntityDeclaration[],
  auth: AuthDeclaration | undefined
): Json {
  if (entities.length === 0 || !Array.isArray(receipt.capabilities)) return receipt
  const byType = new Map(entities.map((e) => [e.typeId, e]))
  let changed = false
  const capabilities = receipt.capabilities.map((cap: unknown) => {
    if (!isObject(cap) || (cap.capability !== 'persistence' && cap.capability !== 'platform/persistence')) return cap
    const config = cap.config
    if (!isObject(config) || !Array.isArray(config.dataSources)) return cap
    const dataSources = config.dataSources.map((s: unknown) => {
      if (!isObject(s) || s.kind !== 'entity' || s.requiresSession !== undefined) return s
      if (typeof s.connector === 'string' && s.connector) return s
      const entity = typeof s.entityType === 'string' ? byType.get(s.entityType) : undefined
      if (!entity || readableSignedOut(s, entity, auth)) return s
      changed = true
      return { ...s, requiresSession: true }
    })
    return { ...cap, config: { ...config, dataSources } }
  })
  return changed ? { ...receipt, capabilities } : receipt
}
