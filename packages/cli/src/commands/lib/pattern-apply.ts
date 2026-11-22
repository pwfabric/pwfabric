/**
 * Applying a pattern atom to a new page, as pattern-format §4 says a host
 * does: the id prefix replaces `{{ID}}`, every declared slot must have a
 * value (none is invented), a string that is exactly one slot takes the
 * value with its JSON type, a slot inside a longer string takes it as text,
 * no slot token may be left, and the wiring moves into the page's
 * `platform/persistence` (`dataSources`, `initialState`, `behaviors`) and
 * `platform/entities` (`formBindings`) configuration.
 */
import { CommandFailure } from './failure.js'
import { isObject, type JsonObject } from './app-files.js'

const SLOT = /\{\{([A-Z0-9_]+)\}\}/g
const WHOLE_SLOT = /^\{\{([A-Z0-9_]+)\}\}$/
const MAIN_SLOTS = new Set(['MAIN', 'BANDS'])

/** A slot's description: the declaration string, or its `description`. */
export function slotDescription(declaration: unknown): string {
  if (typeof declaration === 'string') return declaration
  if (isObject(declaration) && typeof declaration['description'] === 'string') {
    const type = typeof declaration['type'] === 'string' ? ` (${declaration['type']})` : ''
    return `${declaration['description']}${type}`
  }
  return ''
}

/** The declared slots of a pattern, without `{{ID}}` and the main slots (which are filled with blocks, not values). */
export function declaredSlots(pattern: JsonObject): Map<string, unknown> {
  const out = new Map<string, unknown>()
  const placeholders = isObject(pattern['placeholders']) ? pattern['placeholders'] : {}
  for (const [token, declaration] of Object.entries(placeholders)) {
    const name = WHOLE_SLOT.exec(token)?.[1]
    if (!name || name === 'ID' || MAIN_SLOTS.has(name)) continue
    out.set(name, declaration)
  }
  return out
}

function substitute(value: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_SLOT.exec(value)?.[1]
    if (whole !== undefined && values.has(whole)) return values.get(whole)
    return value.replace(SLOT, (token, name: string) => {
      if (!values.has(name)) return token
      const v = values.get(name)
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
      throw new CommandFailure('PATTERN_SLOT_INVALID', `the slot ${name} sits inside a longer string, so it takes text, a number or a boolean, not ${JSON.stringify(v)}`)
    })
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values))
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, values)]))
  return value
}

function leftover(value: unknown): string[] {
  const found = new Set<string>()
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(SLOT)) found.add(m[1] as string)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (isObject(v)) Object.values(v).forEach(walk)
  }
  walk(value)
  return [...found]
}

export interface AppliedPattern {
  readonly blocks: unknown[]
  readonly capabilities: JsonObject[]
}

/**
 * Expands `pattern` with the id prefix `id` and the slot `values`. A slot
 * with no value, or a token left after substitution, is
 * PATTERN_SLOT_MISSING, listing each slot with its description.
 */
export function applyPattern(pattern: JsonObject, id: string, values: ReadonlyMap<string, unknown>): AppliedPattern {
  const slots = declaredSlots(pattern)
  const missing = [...slots.keys()].filter((name) => !values.has(name))
  if (missing.length > 0) {
    throw new CommandFailure('PATTERN_SLOT_MISSING', `the pattern needs a value for every slot (pattern-format §4 step 2)`, {
      lines: [
        `pwf page add: the pattern "${String(pattern['name'])}" needs a value for ${missing.length === 1 ? 'its slot' : 'each of its slots'}; give each with --slot NAME=value (JSON for a list, an object, a number or a boolean):`,
        ...missing.map((name) => `  ${name}: ${slotDescription(slots.get(name))}`),
      ],
    })
  }
  const unknown = [...values.keys()].filter((name) => !slots.has(name))
  if (unknown.length > 0) throw new CommandFailure('PATTERN_SLOT_UNKNOWN', `the pattern "${String(pattern['name'])}" has no slot ${unknown.join(', ')}`)
  const all = new Map(values)
  all.set('ID', id)
  const expand = (member: string): unknown => (pattern[member] === undefined ? undefined : substitute(pattern[member], all))
  const snippet = expand('snippet')
  const wiring = { dataSources: expand('dataSources'), initialState: expand('initialState'), behaviors: expand('behaviors'), formBindings: expand('formBindings') }
  const left = leftover([snippet, wiring])
  if (left.length > 0) throw new CommandFailure('PATTERN_SLOT_MISSING', `the expanded pattern still holds ${left.map((n) => `{{${n}}}`).join(', ')}`)
  const blocks = Array.isArray(snippet) ? snippet : snippet === undefined ? [] : [snippet]
  const capabilities: JsonObject[] = []
  const persistence: JsonObject = {}
  for (const key of ['dataSources', 'initialState', 'behaviors'] as const) if (wiring[key] !== undefined) persistence[key] = wiring[key]
  if (Object.keys(persistence).length > 0) capabilities.push({ capability: 'platform/persistence', config: persistence })
  if (wiring.formBindings !== undefined) capabilities.push({ capability: 'platform/entities', config: { formBindings: wiring.formBindings } })
  return { blocks, capabilities }
}

/** `NAME=value`: JSON when the value parses as a list, an object, a number, a boolean or null; text otherwise. */
export function parseSlotValue(raw: string): [string, unknown] {
  const eq = raw.indexOf('=')
  const name = eq > 0 ? raw.slice(0, eq) : ''
  if (!/^[A-Z0-9_]+$/.test(name)) throw new CommandFailure('PATTERN_SLOT_INVALID', `--slot "${raw}" is not NAME=value with an upper-case slot name`)
  const text = raw.slice(eq + 1)
  if (/^\s*(?:[[{]|-?\d|true\b|false\b|null\b)/.test(text)) {
    try {
      return [name, JSON.parse(text)]
    } catch {
      // text after all ("12 loaves")
    }
  }
  return [name, text]
}
