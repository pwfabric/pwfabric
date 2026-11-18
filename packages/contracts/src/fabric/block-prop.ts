/**
 * Block props — the manifest is the single source of what a block takes.
 *
 * A block's `manifest.json` declares each prop in `definition.props`: its
 * name, its default, whether it takes a binding, whether it is visitor copy,
 * and its SHAPE (`jsonSchema`), written in the JSON-Schema subset below. There
 * is no second definition: a block module carries no schema, and nothing on a
 * visitor's page loads a validation library.
 *
 * This module is the one reading of a declaration, shared by every reader:
 *
 * - the runtime applies it before a block renders ({@link applyBlockProps}):
 *   a missing prop gets its default, a value of the wrong JSON type is coerced
 *   where the coercion is lossless (`"24"` → `24`, `"true"` → `true`,
 *   `24` → `"24"`), and a value that still does not fit is replaced by the
 *   default. It never throws: a bad prop is a developer warning, not a crash;
 * - `pwf validate` and `pwf build` check every receipt against it
 *   ({@link checkPropValue}), so a receipt is judged before it ships, not in
 *   the visitor's browser;
 * - the migration from zod-schema blocks compares a schema with it.
 *
 * Zod-free on purpose, and small: it ships to every visitor.
 *
 * @module @pwfabric/contracts/fabric/block-prop
 */

// ============================================================
// THE DECLARATION
// ============================================================

/** A JSON type a prop shape names. `integer` is a number with no fraction. */
export type PropShapeType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

/** The string formats a shape may name. Another format is ignored by the check. */
export const PROP_FORMATS = ['email', 'uri', 'url', 'uuid', 'date', 'date-time', 'color'] as const
export type PropFormat = (typeof PROP_FORMATS)[number]

/**
 * A prop's shape: the JSON-Schema subset a block manifest writes in
 * `jsonSchema`. Every keyword below is read; any other keyword is reported by
 * {@link propShapeProblems} and ignored by the runtime.
 *
 * - `type` — one JSON type or several (a union of primitives);
 * - `enum` / `const` — the allowed values;
 * - `default` — the value a missing prop (or a missing member of an object
 *   prop, or of an array item) takes;
 * - numbers: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`;
 * - strings: `minLength`, `maxLength`, `pattern` (a `u`-flag RegExp), `format`;
 * - arrays: `items` (the shape of every item), `minItems`, `maxItems`;
 * - objects: `properties`, `required`, `additionalProperties` (`false`, or
 *   the shape of every other member — a record);
 * - `anyOf` / `oneOf` — a union of shapes (a value fits when one branch fits);
 * - `description`, `title`, `examples` — for people and tools, not checked.
 */
export interface PropShape {
  readonly type?: PropShapeType | readonly PropShapeType[]
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly default?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly format?: string
  readonly items?: PropShape
  readonly minItems?: number
  readonly maxItems?: number
  readonly properties?: Readonly<Record<string, PropShape>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | PropShape
  readonly anyOf?: readonly PropShape[]
  readonly oneOf?: readonly PropShape[]
  readonly description?: string
  readonly title?: string
  readonly examples?: readonly unknown[]
}

/** Every keyword {@link PropShape} reads. */
export const PROP_SHAPE_KEYWORDS: readonly string[] = [
  'type', 'enum', 'const', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'format', 'items', 'minItems', 'maxItems', 'properties', 'required',
  'additionalProperties', 'anyOf', 'oneOf', 'description', 'title', 'examples',
]

/**
 * One prop as a block manifest declares it (`definition.props[]`;
 * block-manifest, "Prop descriptor").
 */
export interface BlockPropDescriptor {
  readonly name: string
  /** For people: the prop's type as TypeScript would write it (`"sm" | "md"`). Not read by any check. */
  readonly type?: string
  /** `true`: a placed block must set it (there is no default to fall back on). */
  readonly required?: boolean
  /** The value a block gets when the receipt does not set the prop. Wins over `jsonSchema.default`. */
  readonly default?: unknown
  /** The prop's shape. Absent: any value, unchecked. */
  readonly jsonSchema?: PropShape
  /** `false`: the prop takes a literal only — a `{{…}}` in it renders as written. Absent means bindable. */
  readonly bindable?: boolean
  /** `true`: the prop is words a visitor reads — the app's to write, in its language. */
  readonly copy?: boolean
  readonly description?: string
}

/** The default a descriptor states: its own `default`, else its shape's. `undefined`: none. */
export function propDefault(descriptor: BlockPropDescriptor): unknown {
  if (descriptor.default !== undefined) return descriptor.default
  return descriptor.jsonSchema?.default
}

// ============================================================
// CHECKING A VALUE
// ============================================================

export type PropIssueCode =
  | 'required'
  | 'type'
  | 'enum'
  | 'const'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'format'
  | 'minItems'
  | 'maxItems'
  | 'unknownMember'

/** One way a value does not fit its shape. `path` starts at the prop's name (`items[2].label`). */
export interface PropIssue {
  readonly path: string
  readonly code: PropIssueCode
  readonly message: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The JSON type of a value (`integer` is reported as `number`; `undefined` as `undefined`). */
export function jsonTypeOf(value: unknown): PropShapeType | 'undefined' {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return t
  if (t === 'undefined') return 'undefined'
  return 'object'
}

const typesOf = (shape: PropShape): readonly PropShapeType[] | undefined =>
  shape.type === undefined ? undefined : typeof shape.type === 'string' ? [shape.type] : shape.type

function fitsType(value: unknown, type: PropShapeType): boolean {
  const actual = jsonTypeOf(value)
  if (type === 'integer') return actual === 'number' && Number.isInteger(value)
  if (type === 'number') return actual === 'number' && Number.isFinite(value as number)
  return actual === type
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

const FORMAT_TESTS: Readonly<Record<string, (s: string) => boolean>> = {
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(s),
  url: (s) => /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(s),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)),
  color: (s) => /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch|color)a?\(.*\)|var\(--.*\)|[a-z]+)$/i.test(s.trim()),
}

const show = (v: unknown): string => {
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s
}

/**
 * Every way `value` does not fit `shape`, deepest first. An empty list: it
 * fits. `path` names the value in the messages (the prop's name at the top).
 * `undefined` fits any shape (absence is the descriptor's `required`).
 */
export function checkPropValue(value: unknown, shape: PropShape | undefined, path: string): PropIssue[] {
  const issues: PropIssue[] = []
  if (!shape || value === undefined) return issues
  const add = (code: PropIssueCode, message: string): void => {
    issues.push({ path, code, message: `${path}: ${message}` })
  }

  const branches = shape.anyOf ?? shape.oneOf
  if (branches && branches.length > 0) {
    if (!branches.some((b) => checkPropValue(value, b, path).length === 0)) {
      add('type', `${show(value)} fits none of the ${branches.length} shapes it may take`)
      return issues
    }
  }

  const types = typesOf(shape)
  if (types && !types.some((t) => fitsType(value, t))) {
    add('type', `expected ${types.join(' or ')}, got ${jsonTypeOf(value)} ${show(value)}`)
    return issues
  }
  if (shape.const !== undefined && !sameValue(value, shape.const)) {
    add('const', `must be ${show(shape.const)}, got ${show(value)}`)
  }
  if (shape.enum && !shape.enum.some((e) => sameValue(e, value))) {
    add('enum', `${show(value)} is not one of ${shape.enum.map(show).join(', ')}`)
  }

  if (typeof value === 'number') {
    if (shape.minimum !== undefined && value < shape.minimum) add('minimum', `${value} is below the minimum ${shape.minimum}`)
    if (shape.maximum !== undefined && value > shape.maximum) add('maximum', `${value} is above the maximum ${shape.maximum}`)
    if (shape.exclusiveMinimum !== undefined && value <= shape.exclusiveMinimum)
      add('minimum', `${value} must be above ${shape.exclusiveMinimum}`)
    if (shape.exclusiveMaximum !== undefined && value >= shape.exclusiveMaximum)
      add('maximum', `${value} must be below ${shape.exclusiveMaximum}`)
  } else if (typeof value === 'string') {
    const length = [...value].length
    if (shape.minLength !== undefined && length < shape.minLength) add('minLength', `is shorter than ${shape.minLength} characters`)
    if (shape.maxLength !== undefined && length > shape.maxLength) add('maxLength', `is longer than ${shape.maxLength} characters`)
    if (shape.pattern !== undefined) {
      let re: RegExp | null = null
      try {
        re = new RegExp(shape.pattern, 'u')
      } catch {
        re = null
      }
      if (re && !re.test(value)) add('pattern', `${show(value)} does not match ${shape.pattern}`)
    }
    const test = shape.format !== undefined ? FORMAT_TESTS[shape.format] : undefined
    if (test && !test(value)) add('format', `${show(value)} is not a valid ${shape.format}`)
  } else if (Array.isArray(value)) {
    if (shape.minItems !== undefined && value.length < shape.minItems) add('minItems', `has fewer than ${shape.minItems} items`)
    if (shape.maxItems !== undefined && value.length > shape.maxItems) add('maxItems', `has more than ${shape.maxItems} items`)
    if (shape.items) value.forEach((item, i) => issues.push(...checkPropValue(item, shape.items, `${path}[${i}]`)))
  } else if (isRecord(value)) {
    const props = shape.properties ?? {}
    for (const key of shape.required ?? []) {
      if (value[key] === undefined && props[key]?.default === undefined) {
        issues.push({ path: `${path}.${key}`, code: 'required', message: `${path}.${key}: is required` })
      }
    }
    for (const [key, member] of Object.entries(value)) {
      const declared = props[key]
      if (declared) issues.push(...checkPropValue(member, declared, `${path}.${key}`))
      else if (shape.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, code: 'unknownMember', message: `${path}.${key}: is not a member this prop takes` })
      } else if (isRecord(shape.additionalProperties)) {
        issues.push(...checkPropValue(member, shape.additionalProperties, `${path}.${key}`))
      }
    }
  }
  return issues
}

// ============================================================
// COERCING A VALUE
// ============================================================

function coerceTo(value: unknown, type: PropShapeType): unknown {
  if (fitsType(value, type)) return value
  if ((type === 'number' || type === 'integer') && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim())
    if (Number.isFinite(n) && (type === 'number' || Number.isInteger(n))) return n
  }
  if (type === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  if (type === 'string' && (typeof value === 'number' || typeof value === 'boolean')) return String(value)
  return undefined
}

/**
 * `value` brought to its shape where that loses nothing — a numeric string to
 * a number, `"true"`/`"false"` to a boolean, a number or boolean to a string —
 * with the defaults of missing object members and array-item members filled
 * in. A value that cannot be brought to its shape is returned as it is (the
 * check then reports it). The same reference comes back when nothing changed.
 */
export function coercePropValue(value: unknown, shape: PropShape | undefined): unknown {
  if (!shape || value === undefined) return value
  const branches = shape.anyOf ?? shape.oneOf
  if (branches && branches.length > 0) {
    if (branches.some((b) => checkPropValue(value, b, '').length === 0)) return value
    for (const b of branches) {
      const c = coercePropValue(value, b)
      if (c !== value && checkPropValue(c, b, '').length === 0) return c
    }
    return value
  }
  let out = value
  const types = typesOf(shape)
  if (types && !types.some((t) => fitsType(value, t))) {
    for (const t of types) {
      const c = coerceTo(value, t)
      if (c !== undefined) {
        out = c
        break
      }
    }
  }
  if (Array.isArray(out) && shape.items) {
    const items = shape.items
    let changed = false
    const next = out.map((item: unknown) => {
      const c = coercePropValue(item, items)
      if (c !== item) changed = true
      return c
    })
    if (changed) out = next
  } else if (isRecord(out) && (shape.properties || isRecord(shape.additionalProperties))) {
    const record = out
    const props = shape.properties ?? {}
    let next: Record<string, unknown> | null = null
    const set = (key: string, v: unknown): void => {
      next ??= { ...record }
      next[key] = v
    }
    for (const [key, member] of Object.entries(props)) {
      const current = record[key]
      if (current === undefined) {
        if (member.default !== undefined) set(key, member.default)
        continue
      }
      const c = coercePropValue(current, member)
      if (c !== current) set(key, c)
    }
    if (isRecord(shape.additionalProperties)) {
      const rest = shape.additionalProperties
      for (const [key, current] of Object.entries(record)) {
        if (key in props) continue
        const c = coercePropValue(current, rest)
        if (c !== current) set(key, c)
      }
    }
    if (next) out = next
  }
  return out
}

// ============================================================
// THE RUNTIME'S READING
// ============================================================

/** Whether a shape accepts `null` (so a `null` value is a value, not an absence). */
function acceptsNull(shape: PropShape | undefined): boolean {
  if (!shape) return true
  const types = typesOf(shape)
  if (types) return types.includes('null')
  const branches = shape.anyOf ?? shape.oneOf
  if (branches) return branches.some(acceptsNull)
  return shape.enum ? shape.enum.includes(null) : true
}

/**
 * The props a block renders with: `props` with every declared prop's default
 * filled in where it is missing, values coerced to their shapes, and a value
 * that still does not fit replaced by its default (kept as written when there
 * is none). A `null` where the shape takes no `null` counts as missing. Props
 * the manifest does not declare pass through untouched.
 *
 * Never throws. Each problem goes to `onIssue` (the runtime reports it as a
 * developer warning in `pwf dev`). The same object comes back when nothing
 * changed, so a renderer can memoise on it.
 */
export function applyBlockProps(
  props: Readonly<Record<string, unknown>>,
  descriptors: readonly BlockPropDescriptor[] | undefined,
  onIssue?: (issue: PropIssue) => void
): Readonly<Record<string, unknown>> {
  if (!descriptors || descriptors.length === 0) return props
  let out: Record<string, unknown> | null = null
  const set = (key: string, v: unknown): void => {
    out ??= { ...props }
    out[key] = v
  }
  for (const d of descriptors) {
    const shape = d.jsonSchema
    const fallback = propDefault(d)
    let value = props[d.name]
    if (value === null && !acceptsNull(shape)) value = undefined
    if (value === undefined) {
      if (fallback !== undefined) set(d.name, fallback)
      else {
        if (props[d.name] === null) set(d.name, undefined)
        if (d.required) onIssue?.({ path: d.name, code: 'required', message: `${d.name}: is required` })
      }
      continue
    }
    const coerced = coercePropValue(value, shape)
    const issues = checkPropValue(coerced, shape, d.name)
    if (issues.length > 0) {
      for (const issue of issues) onIssue?.(issue)
      if (fallback !== undefined) set(d.name, fallback)
      else if (coerced !== value) set(d.name, coerced)
    } else if (coerced !== value) {
      set(d.name, coerced)
    }
  }
  return out ?? props
}

// ============================================================
// CHECKING A DECLARATION
// ============================================================

/**
 * What in a declared shape this module cannot read: a keyword outside
 * {@link PROP_SHAPE_KEYWORDS}, a `type` that is not a JSON type, a `pattern`
 * that is not a RegExp, a `default` that does not fit the shape. Messages
 * name the path (`items.label`). `pwf validate` reports them on a manifest.
 */
export function propShapeProblems(shape: unknown, path: string): string[] {
  const out: string[] = []
  if (!isRecord(shape)) return [`${path}: a shape is an object`]
  for (const key of Object.keys(shape)) {
    if (!PROP_SHAPE_KEYWORDS.includes(key) && key !== '$schema') out.push(`${path}: "${key}" is not a keyword a prop shape reads`)
  }
  const types = shape['type'] === undefined ? [] : Array.isArray(shape['type']) ? shape['type'] : [shape['type']]
  for (const t of types) {
    if (!['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(t as string)) {
      out.push(`${path}: type ${show(t)} is not a JSON type`)
    }
  }
  if (typeof shape['pattern'] === 'string') {
    try {
      new RegExp(shape['pattern'], 'u')
    } catch {
      out.push(`${path}: pattern ${show(shape['pattern'])} is not a valid RegExp`)
    }
  }
  if (isRecord(shape['items'])) out.push(...propShapeProblems(shape['items'], `${path}[]`))
  if (isRecord(shape['properties'])) {
    for (const [k, v] of Object.entries(shape['properties'])) out.push(...propShapeProblems(v, `${path}.${k}`))
  }
  if (isRecord(shape['additionalProperties'])) out.push(...propShapeProblems(shape['additionalProperties'], `${path}.*`))
  for (const key of ['anyOf', 'oneOf'] as const) {
    const list = shape[key]
    if (Array.isArray(list)) list.forEach((b, i) => out.push(...propShapeProblems(b, `${path}|${i}`)))
  }
  if (out.length === 0 && shape['default'] !== undefined) {
    for (const issue of checkPropValue(shape['default'], shape as PropShape, `${path} default`)) out.push(issue.message)
  }
  return out
}
