/**
 * Expression Evaluator for Data Binding
 *
 * Enhanced expression evaluation for data binding in surfaces
 *
 * This module extends the base expression evaluator with:
 * - Arithmetic operations (+, -, *, /, %)
 * - Data/state/params context separation
 * - Dependency extraction for reactive updates
 * - Safe null-coalescing operators
 *
 * @module @pwfabric/runtime/binding/expression
 */

// ============================================================
// EXPRESSION CONTEXT
// ============================================================

/**
 * Context for expression evaluation in data binding
 */
export interface BindingExpressionContext {
  /** Data from data sources */
  readonly data: Record<string, unknown>
  /** State from state stores */
  readonly state: Record<string, unknown>
  /** URL/route parameters */
  readonly params: Record<string, unknown>
  /** Custom helper functions */
  readonly helpers?: Record<string, (...args: unknown[]) => unknown>
}

/**
 * Result of expression evaluation
 */
export type ExpressionEvalResult<T = unknown> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: string }

// ============================================================
// EXPRESSION EVALUATOR INTERFACE
// ============================================================

/**
 * Expression evaluator interface for data binding
 */
export interface ExpressionEvaluator {
  /**
   * Evaluate an expression in the given context
   */
  evaluate(expression: string, context: BindingExpressionContext): unknown

  /**
   * Check if a value is an expression (contains {{...}})
   */
  isExpression(value: unknown): boolean

  /**
   * Extract dependencies from an expression for reactive updates
   */
  extractDependencies(expression: string): ExpressionDependency[]

  /**
   * Interpolate expressions in a template string
   */
  interpolate(template: string, context: BindingExpressionContext): string
}

/**
 * Dependency extracted from an expression
 */
export interface ExpressionDependency {
  /** The source of the dependency */
  readonly source: 'data' | 'state' | 'params'
  /** The path within the source */
  readonly path: string
}

// ============================================================
// PATH RESOLUTION
// ============================================================

/**
 * Read one named property off a value, stepping into a list of one record.
 *
 * A LIST SOURCE ALWAYS BINDS AS A LIST (DataBoundSurfaceRenderer): a `rest`,
 * `entity` or `graphql` source answering with ONE object is bound as `[obj]`,
 * so `{{src[0].field}}` and `{{src.length}}` behave the same whatever the
 * endpoint returned. But a detail page is authored as `{{product.title}}`, and
 * a property read on an array finds nothing — such a page would render blank
 * (`{{rows.name}}` → empty while `{{rows[0].name}}` → "banana").
 *
 * So: when the value is an array of EXACTLY ONE element and the array itself
 * does not carry the key (not `length`, not an index, not an array method),
 * the read continues into that one element. A list of two or more is a list —
 * its `.title` stays undefined, as it always was. Both evaluators (this one
 * and surface/expression) read properties through here, so a path means the
 * same thing in a binding and in a block prop.
 */
export function readProperty(target: unknown, key: string): unknown {
  if (target === null || target === undefined || typeof target !== 'object') return undefined
  if (Array.isArray(target) && target.length === 1 && !(key in target)) {
    const only: unknown = target[0]
    return only !== null && typeof only === 'object'
      ? (only as Record<string, unknown>)[key]
      : undefined
  }
  return (target as Record<string, unknown>)[key]
}

/**
 * Resolve a dotted path in an object, handling nested properties and array indices
 *
 * @example
 * resolvePath({ user: { name: 'John' } }, 'user.name') // 'John'
 * resolvePath({ items: ['a', 'b'] }, 'items[0]') // 'a'
 * resolvePath({ users: [{ name: 'John' }] }, 'users[0].name') // 'John'
 */
export function resolvePath(obj: unknown, path: string): unknown {
  if (!path || typeof obj !== 'object' || obj === null) {
    return undefined
  }

  const parts = parsePath(path)
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (part.type === 'property') {
      if (typeof current === 'object') {
        current = readProperty(current, part.key)
      } else {
        return undefined
      }
    } else if (part.type === 'index') {
      if (Array.isArray(current)) {
        current = current[part.index]
      } else {
        return undefined
      }
    }
  }

  return current
}

/**
 * Parsed path segment
 */
type PathSegment = { type: 'property'; key: string } | { type: 'index'; index: number }

/**
 * Parse a path string into segments
 */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  // Match property names and array indices: foo, [0], foo[0], foo.bar[1].baz
  //
  // A HYPHEN is a name CHARACTER. With `\w+` it would be a boundary, and since
  // source ids are hyphenated, `hero-stats.0.text` would split into FOUR
  // segments (`hero`,`stats`,`0`,`text`) instead of three and never resolve.
  // The sibling resolver (surface/expression.ts) accepts hyphenated ids too:
  // its path regex is `/^[\w\-.[\]]+$/`.
  const regex = /([\w-]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      // Property name
      segments.push({ type: 'property', key: match[1] })
    } else if (match[2] !== undefined) {
      // Array index
      segments.push({ type: 'index', index: parseInt(match[2], 10) })
    }
  }

  return segments
}

// ============================================================
// EXPRESSION PARSER — ONE GRAMMAR FOR BOTH EVALUATORS
// ============================================================
//
// This token parser (bindings, computed values) also serves
// surface/expression.ts (every block prop and every `visibleWhen`). A separate
// regex/`split` evaluator there would drift in the ways that matter most to
// generated apps:
//
//   - the surface one had no parentheses, no arithmetic, no method calls — an
//     expression it could not read came back as the raw `{{…}}` string, which
//     a `visibleWhen` then counted as TRUE, so the block always showed;
//   - it split helper arguments on every comma, so `join(xs, ', ')` joined
//     with `""`.
//
// Now there is one tokenizer, one parser producing an AST, and one evaluator.
// What differs between the two callers is only how a NAME resolves (see
// `NameResolver`) and two lexical options kept for backward compatibility.
//
// STRICT BY DESIGN. An unknown character, an unterminated string, a trailing
// token or a call to something that is not a helper is an ERROR, not a partial
// value. The previous parser skipped unknown characters and ignored whatever
// followed the first complete expression (`5-3` evaluated to 5) — a silent
// wrong answer is the failure class this exists to end. Callers decide what an
// error means: a block prop keeps its raw template, a `visibleWhen` hides.
//
// `&&`, `||`, `??` and `?:` SHORT-CIRCUIT, because evaluation walks the AST:
// `isEmpty(x) || x.length > 3` never evaluates the right side when the left
// already decided.

type TokenType =
  | 'number'
  | 'string'
  | 'literal'
  | 'identifier'
  | 'operator'
  | 'paren'
  | 'bracket'
  | 'dot'
  | 'comma'
  | 'question'
  | 'colon'

interface Token {
  type: TokenType
  value: unknown
  raw: string
}

/** Lexical options — the only grammar differences between the two callers. */
export interface ExpressionSyntaxOptions {
  /**
   * `hero-stats-data.0.text` is ONE name. Surface data-source ids are
   * hyphenated, and the surface evaluator always read them as paths, so in
   * that mode a `-` between two name characters with no space around it is
   * part of the name. Subtraction needs spaces there: `a - b`.
   */
  readonly hyphenNames?: boolean
  /** The binding evaluator has always read the literal `undefined` as `null`. */
  readonly undefinedAsNull?: boolean
}

const MULTI_OPS = ['===', '!==', '>=', '<=', '==', '!=', '&&', '||', '??'] as const
const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '>', '<', '!'])

/** A token after which a `-` is binary minus, not the sign of a number. */
function endsValue(t: Token | undefined): boolean {
  if (!t) return false
  if (t.type === 'number' || t.type === 'string' || t.type === 'literal' || t.type === 'identifier') return true
  return (t.type === 'paren' && t.value === ')') || (t.type === 'bracket' && t.value === ']')
}

function tokenize(expr: string, opts: ExpressionSyntaxOptions): Token[] {
  const tokens: Token[] = []
  let i = 0
  const nameChar = /[\w$]/

  const readName = (allowLeadingDigit: boolean): string => {
    let name = ''
    while (i < expr.length) {
      const c = expr.charAt(i)
      if (nameChar.test(c)) {
        name += c
        i++
        continue
      }
      // a hyphen joins two name characters (`hero-stats`) in hyphenNames mode
      if (
        opts.hyphenNames &&
        c === '-' &&
        name.length > 0 &&
        /[\w$]/.test(expr.charAt(i + 1))
      ) {
        name += c
        i++
        continue
      }
      break
    }
    if (!allowLeadingDigit && /^\d/.test(name)) throw new Error(`Unexpected number in name '${name}'`)
    return name
  }

  while (i < expr.length) {
    const ch = expr.charAt(i)
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const prev = tokens[tokens.length - 1]

    // A property name after a dot: digits (`items.0`) and keywords
    // (`item.default`, `row.null`) are names here, never literals.
    if (prev?.type === 'dot' && /[\w$]/.test(ch)) {
      const name = readName(true)
      tokens.push({ type: 'identifier', value: name, raw: name })
      continue
    }

    if (ch === "'" || ch === '"') {
      const quote = ch
      let value = ''
      i++
      let closed = false
      while (i < expr.length) {
        const c = expr.charAt(i)
        if (c === quote) {
          closed = true
          break
        }
        if (c === '\\' && i + 1 < expr.length) {
          i++
          const e = expr.charAt(i)
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e
        } else {
          value += c
        }
        i++
      }
      if (!closed) throw new Error('Unterminated string literal')
      i++
      tokens.push({ type: 'string', value, raw: `${quote}${value}${quote}` })
      continue
    }

    // Numbers. A leading `-` is a sign only where a value cannot end —
    // `5-3` is subtraction, `-3` and `a * -3` are negative literals.
    if (/\d/.test(ch) || (ch === '-' && /\d/.test(expr.charAt(i + 1)) && !endsValue(prev))) {
      let num = ''
      if (ch === '-') {
        num = '-'
        i++
      }
      while (i < expr.length && /\d/.test(expr.charAt(i))) num += expr.charAt(i++)
      if (expr.charAt(i) === '.' && /\d/.test(expr.charAt(i + 1))) {
        num += expr.charAt(i++)
        while (i < expr.length && /\d/.test(expr.charAt(i))) num += expr.charAt(i++)
      }
      tokens.push({ type: 'number', value: parseFloat(num), raw: num })
      continue
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      const name = readName(false)
      if (name === 'true') tokens.push({ type: 'literal', value: true, raw: name })
      else if (name === 'false') tokens.push({ type: 'literal', value: false, raw: name })
      else if (name === 'null') tokens.push({ type: 'literal', value: null, raw: name })
      else if (name === 'undefined')
        tokens.push({ type: 'literal', value: opts.undefinedAsNull ? null : undefined, raw: name })
      else tokens.push({ type: 'identifier', value: name, raw: name })
      continue
    }

    const multi = MULTI_OPS.find((op) => expr.startsWith(op, i))
    if (multi) {
      tokens.push({ type: 'operator', value: multi, raw: multi })
      i += multi.length
      continue
    }

    if (SINGLE_OPS.has(ch)) tokens.push({ type: 'operator', value: ch, raw: ch })
    else if (ch === '(' || ch === ')') tokens.push({ type: 'paren', value: ch, raw: ch })
    else if (ch === '[' || ch === ']') tokens.push({ type: 'bracket', value: ch, raw: ch })
    else if (ch === '.') tokens.push({ type: 'dot', value: ch, raw: ch })
    else if (ch === ',') tokens.push({ type: 'comma', value: ch, raw: ch })
    else if (ch === '?') tokens.push({ type: 'question', value: ch, raw: ch })
    else if (ch === ':') tokens.push({ type: 'colon', value: ch, raw: ch })
    else throw new Error(`Unexpected character '${ch}' at ${i}`)
    i++
  }

  return tokens
}

// ---- AST ----------------------------------------------------------------

type Node =
  | { readonly k: 'lit'; readonly v: unknown }
  | { readonly k: 'name'; readonly name: string }
  | { readonly k: 'member'; readonly obj: Node; readonly prop: string }
  | { readonly k: 'index'; readonly obj: Node; readonly index: Node }
  | { readonly k: 'call'; readonly name: string; readonly args: readonly Node[] }
  | { readonly k: 'method'; readonly obj: Node; readonly name: string; readonly args: readonly Node[] }
  | { readonly k: 'unary'; readonly op: string; readonly arg: Node }
  | { readonly k: 'binary'; readonly op: string; readonly l: Node; readonly r: Node }
  | { readonly k: 'cond'; readonly test: Node; readonly then: Node; readonly else: Node }
  | { readonly k: 'array'; readonly items: readonly Node[] }

const BINARY_LEVELS: readonly (readonly string[])[] = [
  ['||'],
  ['&&'],
  ['??'],
  ['===', '!==', '==', '!='],
  ['>', '<', '>=', '<='],
  ['+', '-'],
  ['*', '/', '%'],
]

function parse(tokens: readonly Token[]): Node {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const is = (type: TokenType, value?: unknown): boolean => {
    const t = tokens[pos]
    return t !== undefined && t.type === type && (value === undefined || t.value === value)
  }
  const expect = (type: TokenType, value: unknown, what: string): void => {
    if (!is(type, value)) throw new Error(`Expected ${what}`)
    pos++
  }

  const parseArgs = (close: string, closeType: TokenType): Node[] => {
    const args: Node[] = []
    if (is(closeType, close)) {
      pos++
      return args
    }
    for (;;) {
      args.push(parseTernary())
      if (is('comma')) {
        pos++
        continue
      }
      expect(closeType, close, `'${close}'`)
      return args
    }
  }

  function parseTernary(): Node {
    const test = parseBinary(0)
    if (!is('question')) return test
    pos++
    const then = parseTernary()
    expect('colon', ':', "':' in ternary expression")
    return { k: 'cond', test, then, else: parseTernary() }
  }

  function parseBinary(level: number): Node {
    const ops = BINARY_LEVELS[level]
    if (!ops) return parseUnary()
    let left = parseBinary(level + 1)
    for (;;) {
      const t = peek()
      if (!t || t.type !== 'operator' || !ops.includes(t.value as string)) return left
      pos++
      left = { k: 'binary', op: t.value as string, l: left, r: parseBinary(level + 1) }
    }
  }

  function parseUnary(): Node {
    if (is('operator', '!') || is('operator', '-') || is('operator', '+')) {
      const op = (tokens[pos++] as Token).value as string
      return { k: 'unary', op, arg: parseUnary() }
    }
    return parsePostfix()
  }

  function parsePostfix(): Node {
    let node = parsePrimary()
    for (;;) {
      if (is('dot')) {
        pos++
        const t = peek()
        if (!t || t.type !== 'identifier') throw new Error('Expected property name after .')
        pos++
        const name = t.value as string
        if (is('paren', '(')) {
          pos++
          node = { k: 'method', obj: node, name, args: parseArgs(')', 'paren') }
        } else {
          node = { k: 'member', obj: node, prop: name }
        }
      } else if (is('bracket', '[')) {
        pos++
        const index = parseTernary()
        expect('bracket', ']', "']'")
        node = { k: 'index', obj: node, index }
      } else if (is('paren', '(')) {
        throw new Error('Only helpers and safe methods can be called')
      } else {
        return node
      }
    }
  }

  function parsePrimary(): Node {
    const t = peek()
    if (!t) throw new Error('Unexpected end of expression')
    if (t.type === 'number' || t.type === 'string' || t.type === 'literal') {
      pos++
      return { k: 'lit', v: t.value }
    }
    if (t.type === 'identifier') {
      pos++
      const name = t.value as string
      if (is('paren', '(')) {
        pos++
        return { k: 'call', name, args: parseArgs(')', 'paren') }
      }
      return { k: 'name', name }
    }
    if (is('paren', '(')) {
      pos++
      const inner = parseTernary()
      expect('paren', ')', "')'")
      return inner
    }
    if (is('bracket', '[')) {
      pos++
      return { k: 'array', items: parseArgs(']', 'bracket') }
    }
    throw new Error(`Unexpected token '${t.raw}'`)
  }

  const root = parseTernary()
  if (pos < tokens.length) throw new Error(`Unexpected token '${(tokens[pos] as Token).raw}'`)
  return root
}

/**
 * Parse once, evaluate many times. Block props are re-resolved on every state
 * change, and the same few hundred template strings come through each time.
 */
const AST_CACHE_LIMIT = 2000
const astCache = new Map<string, Node | Error>()

function parseCached(expr: string, opts: ExpressionSyntaxOptions): Node {
  const key = `${opts.hyphenNames ? 'h' : '-'}${opts.undefinedAsNull ? 'n' : '-'}${expr}`
  let hit = astCache.get(key)
  if (hit === undefined) {
    try {
      hit = parse(tokenize(expr, opts))
    } catch (e) {
      hit = e instanceof Error ? e : new Error(String(e))
    }
    if (astCache.size >= AST_CACHE_LIMIT) astCache.clear()
    astCache.set(key, hit)
  }
  if (hit instanceof Error) throw hit
  return hit
}

// ---- evaluation ---------------------------------------------------------

/**
 * How a bare name and a call resolve. The grammar is shared; the scope is the
 * caller's: bindings see `data` / `state` / `params`, block props see the
 * surface's expression data (`state`, source ids, `item`, `__errors`, …).
 */
export interface NameResolver {
  /** The value of a bare name. */
  lookup(name: string): unknown
  /** The helper a call names, or undefined when there is none. */
  helper(name: string): ((...args: unknown[]) => unknown) | undefined
}

/**
 * Methods that may be called on a value. Pure, allocation-bounded, and
 * nothing that reaches a constructor, a prototype or a function: a template
 * is authored by a model and rendered in a visitor's browser.
 */
const STRING_METHODS = new Set([
  'toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'includes', 'startsWith', 'endsWith',
  'indexOf', 'lastIndexOf', 'slice', 'substring', 'padStart', 'padEnd', 'split', 'replace',
  'replaceAll', 'charAt', 'at', 'concat', 'repeat', 'toString', 'localeCompare',
])
const ARRAY_METHODS = new Set(['includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'at', 'concat'])
const NUMBER_METHODS = new Set(['toFixed', 'toPrecision', 'toString', 'toLocaleString'])

function callMethod(target: unknown, name: string, args: unknown[]): unknown {
  if (target === null || target === undefined) return undefined
  let allowed = false
  if (typeof target === 'string') allowed = STRING_METHODS.has(name)
  else if (Array.isArray(target)) allowed = ARRAY_METHODS.has(name)
  else if (typeof target === 'number') allowed = NUMBER_METHODS.has(name)
  if (!allowed) throw new Error(`Method '${name}' is not supported`)
  // A `repeat`/`padStart` count from data must not allocate without bound.
  if ((name === 'repeat' || name === 'padStart' || name === 'padEnd') && Number(args[0]) > 10_000) {
    throw new Error(`Method '${name}' argument too large`)
  }
  const fn = (target as unknown as Record<string, unknown>)[name] as (...a: unknown[]) => unknown
  return fn.apply(target, args)
}

function readMember(target: unknown, prop: string): unknown {
  if (typeof target === 'string') return prop === 'length' ? target.length : undefined
  if (target !== null && target !== undefined && typeof target === 'object') return readProperty(target, prop)
  return undefined
}

function evalNode(node: Node, scope: NameResolver): unknown {
  switch (node.k) {
    case 'lit':
      return node.v
    case 'name':
      return scope.lookup(node.name)
    case 'member':
      return readMember(evalNode(node.obj, scope), node.prop)
    case 'index': {
      const target = evalNode(node.obj, scope)
      const index = evalNode(node.index, scope)
      if (target === null || target === undefined) return undefined
      if (Array.isArray(target)) return target[index as number]
      if (typeof target === 'object') return (target as Record<string, unknown>)[String(index)]
      return undefined
    }
    case 'call': {
      const fn = scope.helper(node.name)
      if (typeof fn !== 'function') throw new Error(`Unknown helper: ${node.name}`)
      return fn(...node.args.map((a) => evalNode(a, scope)))
    }
    case 'method':
      return callMethod(
        evalNode(node.obj, scope),
        node.name,
        node.args.map((a) => evalNode(a, scope))
      )
    case 'unary': {
      const v = evalNode(node.arg, scope)
      if (node.op === '!') return !v
      if (node.op === '-') return -(v as number)
      return +(v as number)
    }
    case 'cond':
      return evalNode(node.test, scope) ? evalNode(node.then, scope) : evalNode(node.else, scope)
    case 'array':
      return node.items.map((n) => evalNode(n, scope))
    case 'binary': {
      // short-circuiting operators first — the right side may never run
      if (node.op === '&&') {
        const l = evalNode(node.l, scope)
        return l ? evalNode(node.r, scope) : l
      }
      if (node.op === '||') {
        const l = evalNode(node.l, scope)
        return l ? l : evalNode(node.r, scope)
      }
      if (node.op === '??') {
        const l = evalNode(node.l, scope)
        return l ?? evalNode(node.r, scope)
      }
      const l = evalNode(node.l, scope)
      const r = evalNode(node.r, scope)
      switch (node.op) {
        case '===': return l === r
        case '!==': return l !== r
        case '==': return l == r
        case '!=': return l != r
        case '>': return (l as number) > (r as number)
        case '<': return (l as number) < (r as number)
        case '>=': return (l as number) >= (r as number)
        case '<=': return (l as number) <= (r as number)
        case '+':
          return typeof l === 'string' || typeof r === 'string'
            ? String(l) + String(r)
            : (l as number) + (r as number)
        case '-': return (l as number) - (r as number)
        case '*': return (l as number) * (r as number)
        case '/': return (l as number) / (r as number)
        case '%': return (l as number) % (r as number)
      }
      throw new Error(`Unknown operator ${node.op}`)
    }
  }
}

/**
 * Evaluate one expression (the text between `{{` and `}}`) against a scope.
 * Throws on a syntax error, an unknown helper or an unsupported method — the
 * two public evaluators turn that into `{ success: false }`.
 */
export function evaluateWithScope(
  expression: string,
  scope: NameResolver,
  opts: ExpressionSyntaxOptions = {}
): unknown {
  const trimmed = expression.trim()
  if (!trimmed) return undefined
  return evalNode(parseCached(trimmed, opts), scope)
}

// ============================================================
// EXPRESSION EVALUATOR IMPLEMENTATION
// ============================================================

/**
 * Evaluate an expression with full context support
 */
export function evaluateExpression(
  expression: string,
  context: BindingExpressionContext
): ExpressionEvalResult {
  try {
    const helpers = context.helpers
    const scope: NameResolver = {
      lookup(name) {
        if (name === 'data') return context.data
        if (name === 'state') return context.state
        if (name === 'params') return context.params
        // A helper named bare (without a call) has always resolved to the
        // function itself here; kept.
        if (helpers && Object.prototype.hasOwnProperty.call(helpers, name)) return helpers[name]
        // Shorthand access. Priority: params > state > data (most specific first)
        if (name in context.params) return context.params[name]
        if (name in context.state) return context.state[name]
        if (name in context.data) return context.data[name]
        return undefined
      },
      helper: (name) => (helpers && Object.prototype.hasOwnProperty.call(helpers, name) ? helpers[name] : undefined),
    }
    return { success: true, value: evaluateWithScope(expression, scope, { undefinedAsNull: true }) }
  } catch (e) {
    return { success: false, error: `Expression error: ${e}` }
  }
}

// ============================================================
// DEPENDENCY EXTRACTION
// ============================================================

/**
 * Extract dependencies from an expression for reactive updates
 */
export function extractDependencies(expression: string): ExpressionDependency[] {
  const dependencies: ExpressionDependency[] = []
  const seen = new Set<string>()

  // Match patterns like: data.foo.bar, state.count, params.id
  // Also match shorthand: foo.bar (when referring to data/state/params root)
  const patterns = [
    /\bdata\.(\w+(?:\.\w+|\[\d+\])*)/g,
    /\bstate\.(\w+(?:\.\w+|\[\d+\])*)/g,
    /\bparams\.(\w+(?:\.\w+|\[\d+\])*)/g,
  ]

  const sources: readonly ('data' | 'state' | 'params')[] = ['data', 'state', 'params']

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]
    const source = sources[i]
    if (!pattern || !source) continue

    let match: RegExpExecArray | null

    while ((match = pattern.exec(expression)) !== null) {
      const path = match[1]
      if (path === undefined) continue
      const key = `${source}.${path}`
      if (!seen.has(key)) {
        seen.add(key)
        dependencies.push({ source, path })
      }
    }
  }

  return dependencies
}

// ============================================================
// INTERPOLATION
// ============================================================

/**
 * Check if a value contains expression syntax
 */
export function isExpression(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /\{\{.+?\}\}/.test(value)
}

/**
 * Interpolate expressions within a template string
 *
 * @example
 * interpolate('Hello, {{user.name}}!', context) // 'Hello, John!'
 * interpolate('Total: {{price * quantity}}', context) // 'Total: 100'
 */
export function interpolate(template: string, context: BindingExpressionContext): string {
  const pattern = /\{\{(.+?)\}\}/g
  return template.replace(pattern, (_, expr: string) => {
    const result = evaluateExpression(expr.trim(), context)
    if (result.success) {
      return String(result.value ?? '')
    }
    return ''
  })
}

// ============================================================
// DEFAULT HELPERS
// ============================================================

/**
 * Default helper functions for expressions
 */
export const DEFAULT_BINDING_HELPERS: Record<string, (...args: unknown[]) => unknown> = {
  // String helpers
  upper: (s: unknown) => String(s).toUpperCase(),
  lower: (s: unknown) => String(s).toLowerCase(),
  trim: (s: unknown) => String(s).trim(),
  capitalize: (s: unknown) => {
    const str = String(s)
    return str.charAt(0).toUpperCase() + str.slice(1)
  },
  concat: (...args: unknown[]) => args.map(String).join(''),

  // Number helpers
  round: (n: unknown, decimals?: unknown) => {
    const num = Number(n)
    const d = Number(decimals ?? 0)
    return Math.round(num * Math.pow(10, d)) / Math.pow(10, d)
  },
  floor: (n: unknown) => Math.floor(Number(n)),
  ceil: (n: unknown) => Math.ceil(Number(n)),
  abs: (n: unknown) => Math.abs(Number(n)),
  min: (...args: unknown[]) => Math.min(...args.map(Number)),
  max: (...args: unknown[]) => Math.max(...args.map(Number)),
  /**
   * How many pages `total` rows fill at `size` per page — `ceil(total / size)`,
   * but SAFE: a missing, non-numeric, zero or negative total or size gives 0,
   * never `NaN` or `Infinity` (the envelope is absent until the first fetch
   * lands). Pair with `__meta.<source>.total` on a `returns` source:
   * `{{pages(__meta.products.total, 20)}}`. Wrap in `max(1, …)` for a pager
   * that should read "1 / 1" on an empty list.
   */
  pages: (total: unknown, size: unknown) => {
    const t = Number(total)
    const s = Number(size)
    if (!Number.isFinite(t) || !Number.isFinite(s) || t <= 0 || s <= 0) return 0
    return Math.ceil(t / s)
  },

  // Aggregate helpers — one data source, several KPI figures. Without these a
  // KPI strip needed one source (one fetch) per number. Filtering stays the
  // data layer's job (EntityQuery.filter); these only fold what is already
  // fetched.
  sumBy: (items: unknown, field?: unknown) => {
    if (!Array.isArray(items)) return 0
    const f = field === undefined ? undefined : String(field)
    return items.reduce<number>((acc, it) => {
      const v = f === undefined ? it : (it as Record<string, unknown> | null)?.[f]
      const n = Number(v)
      return Number.isFinite(n) ? acc + n : acc
    }, 0)
  },
  groupCount: (items: unknown, field: unknown) => {
    const out: Record<string, number> = {}
    if (!Array.isArray(items)) return out
    const f = String(field)
    for (const it of items) {
      const v = (it as Record<string, unknown> | null)?.[f]
      const key = v === null || v === undefined || v === '' ? 'unknown' : String(v)
      out[key] = (out[key] ?? 0) + 1
    }
    return out
  },

  // Array helpers
  length: (arr: unknown) => (Array.isArray(arr) ? arr.length : String(arr).length),
  first: (arr: unknown) => (Array.isArray(arr) ? arr[0] : undefined),
  last: (arr: unknown) => (Array.isArray(arr) ? arr[arr.length - 1] : undefined),
  join: (arr: unknown, sep?: unknown) =>
    Array.isArray(arr) ? arr.join(String(sep ?? ',')) : String(arr),
  includes: (arr: unknown, item: unknown) =>
    Array.isArray(arr) ? arr.includes(item) : String(arr).includes(String(item)),
  slice: (arr: unknown, start?: unknown, end?: unknown) => {
    if (Array.isArray(arr)) {
      return arr.slice(
        start !== undefined ? Number(start) : undefined,
        end !== undefined ? Number(end) : undefined
      )
    }
    return String(arr).slice(
      start !== undefined ? Number(start) : undefined,
      end !== undefined ? Number(end) : undefined
    )
  },

  // Type checks
  isEmpty: (v: unknown) =>
    v === null ||
    v === undefined ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && Object.keys(v).length === 0),
  isNotEmpty: (v: unknown) =>
    v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
  isArray: (v: unknown) => Array.isArray(v),
  isString: (v: unknown) => typeof v === 'string',
  isNumber: (v: unknown) => typeof v === 'number' && !isNaN(v),
  isBoolean: (v: unknown) => typeof v === 'boolean',
  isNull: (v: unknown) => v === null || v === undefined,

  // Object helpers
  keys: (obj: unknown) => (typeof obj === 'object' && obj !== null ? Object.keys(obj) : []),
  values: (obj: unknown) => (typeof obj === 'object' && obj !== null ? Object.values(obj) : []),

  // Formatting helpers
  json: (v: unknown) => JSON.stringify(v),
  /**
   * Today's date in the visitor's time zone, as `YYYY-MM-DD`.
   * The shape date fields are stored in, so it compares as a string:
   * `{{event.date >= today()}}` for "upcoming", `today(-7)` for a week ago.
   * The optional argument shifts by whole days. Before this an "upcoming"
   * filter had nothing to compare against and a page hard-coded a date.
   */
  today: (offsetDays?: unknown) => {
    const d = new Date()
    const shift = Number(offsetDays ?? 0)
    if (Number.isFinite(shift) && shift !== 0) d.setDate(d.getDate() + Math.trunc(shift))
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  },
  date: (v: unknown) => new Date(v as string | number).toLocaleDateString(),
  time: (v: unknown) => new Date(v as string | number).toLocaleTimeString(),
  datetime: (v: unknown) => new Date(v as string | number).toLocaleString(),
  currency: (v: unknown, currency?: unknown, locale?: unknown) => {
    const num = Number(v)
    return new Intl.NumberFormat(String(locale ?? 'en-US'), {
      style: 'currency',
      currency: String(currency ?? 'USD'),
    }).format(num)
  },
  percent: (v: unknown, decimals?: unknown) => {
    const num = Number(v)
    const d = Number(decimals ?? 0)
    return `${(num * 100).toFixed(d)}%`
  },
}

// ============================================================
// EXPRESSION EVALUATOR FACTORY
// ============================================================

/**
 * Create an expression evaluator with context and helpers
 */
export function createExpressionEvaluator(
  additionalHelpers?: Record<string, (...args: unknown[]) => unknown>
): ExpressionEvaluator {
  const helpers = { ...DEFAULT_BINDING_HELPERS, ...additionalHelpers }

  return {
    evaluate(expression: string, context: BindingExpressionContext): unknown {
      const result = evaluateExpression(expression, {
        ...context,
        helpers: { ...helpers, ...context.helpers },
      })
      if (result.success) {
        return result.value
      }
      throw new Error(result.error)
    },

    isExpression,

    extractDependencies,

    interpolate(template: string, context: BindingExpressionContext): string {
      return interpolate(template, {
        ...context,
        helpers: { ...helpers, ...context.helpers },
      })
    },
  }
}
