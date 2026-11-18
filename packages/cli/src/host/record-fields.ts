/**
 * THE RECORD'S FIELDS, ON THE SOURCE THAT WRITES IT.
 *
 * A form writing to the app's own records sent every named control, so a
 * helper (a one-time code, a "confirm e-mail" box) made the record host
 * refuse the whole write: "code: is not a field of this record", 400. The
 * browser cannot tell a field from a helper — the entity declaration
 * (`app/definitions/entities.json`) is not in the envelope — so the build
 * writes the declared fields (name → type) onto every own-records `entity`
 * source as `fields` (data-protocol §4.1), and a write to that source sends
 * those only, each as its type.
 *
 * Own records only: an `entity` source with no `connector` and no
 * `aggregate` (a number is never written), of a type the app declares with at
 * least one writable field. A source that already states `fields`
 * keeps them. Every later rewrite of the source (the record host's, the
 * runner's) carries the member along.
 *
 * @module @pwfabric/cli/host/record-fields
 */

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** The fields a record's writer sends, name → type. */
export type RecordFields = Readonly<Record<string, string>>

/**
 * Each declared type's writable fields, name → type, from `entities.json` as
 * written. A field the server sets by role (`owner`, `createdAt`,
 * `updatedAt`) is left out — a client never sends it; a `{ default }` field
 * stays, an update may move it.
 */
export function declaredRecordFields(entitiesDoc: unknown): ReadonlyMap<string, RecordFields> {
  const out = new Map<string, RecordFields>()
  const list = isObject(entitiesDoc) && Array.isArray(entitiesDoc.entities) ? entitiesDoc.entities : []
  for (const e of list) {
    if (!isObject(e) || typeof e.typeId !== 'string' || !e.typeId) continue
    const fields: Record<string, string> = {}
    for (const f of Array.isArray(e.fields) ? e.fields : []) {
      if (!isObject(f) || typeof f.name !== 'string' || f.name === '') continue
      if (typeof f.server === 'string') continue
      fields[f.name] = typeof f.type === 'string' ? f.type : 'text'
    }
    if (Object.keys(fields).length > 0) out.set(e.typeId, fields)
  }
  return out
}

/** `receipt` with `fields` on its own-records entity sources, or the same object when nothing changes. */
export function withRecordFields(receipt: Json, declared: ReadonlyMap<string, RecordFields>): Json {
  if (declared.size === 0 || !Array.isArray(receipt.capabilities)) return receipt
  let changed = false
  const capabilities = receipt.capabilities.map((cap: unknown) => {
    if (!isObject(cap) || (cap.capability !== 'persistence' && cap.capability !== 'platform/persistence')) return cap
    const config = cap.config
    if (!isObject(config) || !Array.isArray(config.dataSources)) return cap
    const dataSources = config.dataSources.map((s: unknown) => {
      if (!isObject(s) || s.kind !== 'entity' || s.fields !== undefined || s.aggregate !== undefined) return s
      if (typeof s.connector === 'string' && s.connector) return s
      const fields = typeof s.entityType === 'string' ? declared.get(s.entityType) : undefined
      if (!fields) return s
      changed = true
      return { ...s, fields: { ...fields } }
    })
    return { ...cap, config: { ...config, dataSources } }
  })
  return changed ? { ...receipt, capabilities } : receipt
}
