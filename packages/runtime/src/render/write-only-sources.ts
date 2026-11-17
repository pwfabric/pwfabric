/**
 * WRITE-ONLY SOURCES — a form's target that nothing on the page reads.
 *
 * A data source a form writes to (`platform/entities` `config.formBindings[].sourceId`)
 * was also fetched as a list on mount and again after every submit (the
 * bridge's `refreshAll`). For an intake-only model — anonymous visitors may
 * create, never list — that is a refused request on every visit and every
 * submit (`GET /_host/records/<model>` → 403
 * `RECORDS_NOT_PUBLIC`, `__errors.records` set, no block bound to it).
 *
 * A source is write-only when:
 *  - at least one form binding targets it, and every binding that does writes
 *    with POST (a PATCH/PUT needs the loaded record to know what to update), and
 *  - its id is referenced NOWHERE else: no block (props, expressions, actions,
 *    repeat), no behavior, no other source, no other capability config.
 *
 * WHAT COUNTS AS A READ. A page reads a source through an expression
 * (`{{orders}}`, `{{__errors.orders}}`, `{{length(orders)}}`) or by naming it
 * whole as a value (`{ "type": "refresh", "sourceId": "orders" }`). So a
 * string reads `<id>` when it IS the id, or when one of its `{{ … }}`
 * expressions names the id as a whole word. Plain text does not: the check
 * used to search every string for the word, and the shop's own nav link
 * `/orders` (label "Orders" aside) made the checkout's write-only `orders`
 * source read — a 401 on every visit to a page that only creates orders.
 * Inside an expression the search still errs on the side of fetching. A
 * `write` action names its source to write it, not to read it.
 * A write-only source stays declared and registered — it is still the write
 * target — it is just never asked for its rows.
 *
 * @module @pwfabric/runtime/render/write-only-sources
 */

import { isCapability } from '../capability/type-mapping.js'

interface FormBindingLike {
  readonly sourceId?: unknown
  readonly method?: unknown
}

interface CapabilityLike {
  readonly capability?: string
  readonly config?: unknown
}

export interface WriteOnlySourceInput {
  readonly blocks: readonly unknown[]
  readonly dataSources: readonly { readonly id: string }[]
  readonly capabilities?: readonly unknown[] | undefined
  readonly behaviors?: readonly unknown[] | undefined
}

function collectStrings(value: unknown, out: string[], seen: Set<object>): void {
  collectInto(value, out, seen)
}

function collectInto(value: unknown, out: string[], seen: Set<object>): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const v of value) collectInto(v, out, seen)
    return
  }
  const isWrite = (value as Record<string, unknown>)['type'] === 'write'
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isWrite && k === 'sourceId') continue
    // A key can be a reference too (`{ records: … }` maps).
    out.push(k)
    collectInto(v, out, seen)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The ids of the declared sources that are only ever written to. */
export function writeOnlySourceIds(input: WriteOnlySourceInput): ReadonlySet<string> {
  const capabilities = (input.capabilities ?? []) as readonly CapabilityLike[]
  const entities = capabilities.find((c) => isCapability(c, 'platform/entities'))
  const bindings = (entities?.config as { formBindings?: unknown } | undefined)?.formBindings
  if (!Array.isArray(bindings) || bindings.length === 0) return new Set()

  // Candidates: targeted by a form, and only ever with POST.
  const postOnly = new Map<string, boolean>()
  for (const raw of bindings as readonly FormBindingLike[]) {
    if (typeof raw?.sourceId !== 'string') continue
    const isPost = raw.method === undefined || raw.method === 'POST'
    postOnly.set(raw.sourceId, (postOnly.get(raw.sourceId) ?? true) && isPost)
  }
  const declared = new Set(input.dataSources.map((s) => s.id))
  const candidates = [...postOnly].filter(([id, post]) => post && declared.has(id)).map(([id]) => id)
  if (candidates.length === 0) return new Set()

  // Everything that could read a source, minus the declarations themselves:
  // the form bindings (they ARE the write) and the source list (each source is
  // checked against the OTHER sources below).
  const strings: string[] = []
  const seen = new Set<object>()
  collectStrings(input.blocks, strings, seen)
  collectStrings(input.behaviors ?? [], strings, seen)
  for (const c of capabilities) {
    const config = c.config
    if (config === null || typeof config !== 'object') continue
    const rest: Record<string, unknown> = { ...(config as Record<string, unknown>) }
    delete rest['dataSources']
    delete rest['behaviors'] // collected above (the same list, seeded from persistence)
    if (c === entities) delete rest['formBindings']
    collectStrings(rest, strings, seen)
  }

  const result = new Set<string>()
  for (const id of candidates) {
    const others: string[] = []
    for (const s of input.dataSources) if (s.id !== id) collectStrings(s, others, new Set())
    const read = strings.some((s) => readsSource(s, id)) || others.some((s) => readsSource(s, id))
    if (!read) result.add(id)
  }
  return result
}

const EXPRESSION = /\{\{([\s\S]*?)\}\}/g

/** Does `text` read the source `id` — is it the id, or does an expression in it name the id? */
function readsSource(text: string, id: string): boolean {
  if (text.trim() === id) return true
  if (!text.includes('{{')) return false
  const word = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(id)}([^A-Za-z0-9_$]|$)`)
  for (const m of text.matchAll(EXPRESSION)) {
    if (word.test(m[1] ?? '')) return true
  }
  return false
}
