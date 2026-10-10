/**
 * Expression Evaluator
 *
 * Safe expression evaluation for surface rendering
 *
 * Expressions are used in conditionals, loops, and data bindings.
 * This evaluator provides a safe, sandboxed way to evaluate expressions.
 *
 * @module @pwfabric/runtime/surface/expression
 */

// ============================================================
// EXPRESSION TYPES
// ============================================================

/**
 * Expression result
 */
import { DEFAULT_BINDING_HELPERS, evaluateWithScope, readProperty } from '../binding/expression.js'

export type ExpressionResult<T = unknown> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: string }

/**
 * Expression context - the scope for evaluation
 */
export interface ExpressionContext {
  readonly data: Record<string, unknown>
  readonly helpers?: Record<string, (...args: unknown[]) => unknown>
}

// ============================================================
// PATH RESOLUTION
// ============================================================

/**
 * Resolve a dotted path in an object
 * e.g., "user.profile.name" -> obj.user.profile.name
 */
export function resolvePath(obj: unknown, path: string): unknown {
  if (!path || typeof obj !== 'object' || obj === null) {
    return undefined
  }

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }

    // Handle array indexing: items[0]
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
    if (arrayMatch) {
      const prop = arrayMatch[1]
      const index = arrayMatch[2]
      if (prop && index) {
        current = readProperty(current, prop)
        if (Array.isArray(current)) {
          current = current[parseInt(index, 10)]
        } else {
          return undefined
        }
      }
    } else if (typeof current === 'object') {
      // A list of ONE record is read through — see readProperty.
      current = readProperty(current, part)
    } else {
      return undefined
    }
  }

  return current
}

// ============================================================
// EXPRESSION EVALUATOR
// ============================================================

/**
 * Evaluate an expression (the text between `{{` and `}}`).
 *
 * THE SAME PARSER AS THE BINDING EVALUATOR (binding/expression.ts). This used
 * to be a regex/`split` evaluator of its own, and the two drifted: no
 * parentheses, no arithmetic, helper arguments split on every comma — so
 * `{{a == 'x' && (b || c)}}` failed, and a failed `visibleWhen` rendered its
 * raw template, which counts as visible.
 *
 * Supported: paths (`user.name`, `items[0]`, `items.0`, hyphenated source ids
 * `hero-stats.0.text`), literals, `! - +`, `* / %`, `+ -`, comparisons,
 * `&& || ??` (short-circuit), `?:`, parentheses, array literals, helper calls
 * (`join(xs, ', ')`) and a safe list of string / array / number methods
 * (`name.toLowerCase().includes(q)`).
 *
 * Names resolve against `context.data`; a call resolves against
 * `context.helpers`. In this mode a `-` between two name characters is part of
 * the name (source ids are hyphenated) — write subtraction as `a - b`.
 *
 * A syntax error, an unknown helper or an unsupported method is a FAILURE
 * (`success: false`), never a partial value.
 */
export function evaluate(expression: string, context: ExpressionContext): ExpressionResult {
  try {
    const data = context.data
    const helpers = context.helpers
    const value = evaluateWithScope(
      expression,
      {
        lookup: (name) => data[name],
        helper: (name) =>
          helpers && Object.prototype.hasOwnProperty.call(helpers, name) ? helpers[name] : undefined,
      },
      { hyphenNames: true }
    )
    return { success: true, value }
  } catch (e) {
    return { success: false, error: `Unable to evaluate expression: ${expression.trim()} — ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ============================================================
// INTERPOLATION
// ============================================================

/**
 * Interpolate expressions within a template string
 * e.g., "Hello, {{user.name}}!" -> "Hello, John!"
 */
export function interpolate(
  template: string,
  context: ExpressionContext
): ExpressionResult<string> {
  const pattern = /\{\{(.+?)\}\}/g
  let result = template
  let match: RegExpExecArray | null

  while ((match = pattern.exec(template)) !== null) {
    const placeholder = match[0]
    const expression = match[1]
    if (!expression) continue
    const evalResult = evaluate(expression.trim(), context)
    if (!evalResult.success) {
      return evalResult as ExpressionResult<string>
    }
    // CALLBACK replacer, NOT a string replacement. When its second argument is
    // a string, `String.replace` treats `$&`, `$\``, `$'`, `$$` as REPLACEMENT
    // PATTERNS: `"$$5"` in the data would print as `"$5"`, and `"a$&b"` would
    // bring back the placeholder itself. The sibling evaluator
    // (binding/expression.ts) uses a callback too.
    const replacement = String(evalResult.value ?? '')
    result = result.replace(placeholder, () => replacement)
  }

  return { success: true, value: result }
}

// ============================================================
// BUILT-IN HELPERS
// ============================================================

/**
 * Default helper functions available in expressions
 */
export const DEFAULT_HELPERS: Record<string, (...args: unknown[]) => unknown> = {
  // The binding evaluator's helper set comes first. Two evaluators exist —
  // binding/expression (bindings, computed values) and this one (block props
  // through resolveBlockExpressions) — and their helper lists drifted:
  // `sumBy`, `groupCount`, `min`, `max`, `currency`, `date`… live in the
  // binding set, and without it a KPI tile authored as
  // `{{sumBy(customers,'mrr')}}` would render the raw template. One name, one meaning: the surface-specific entries below
  // override where both define the same name.
  ...DEFAULT_BINDING_HELPERS,
  // String helpers
  upper: (s: unknown) => String(s).toUpperCase(),
  lower: (s: unknown) => String(s).toLowerCase(),
  trim: (s: unknown) => String(s).trim(),
  length: (s: unknown) => (Array.isArray(s) ? s.length : String(s).length),
  concat: (...args: unknown[]) => args.map(String).join(''),

  // Number helpers
  // `round` comes from the binding set: `round(n)` as before, `round(n, 2)`
  // to two decimals (this override used to drop the second argument).
  floor: (n: unknown) => Math.floor(Number(n)),
  ceil: (n: unknown) => Math.ceil(Number(n)),
  abs: (n: unknown) => Math.abs(Number(n)),

  // Array helpers
  first: (arr: unknown) => (Array.isArray(arr) ? arr[0] : undefined),
  last: (arr: unknown) => (Array.isArray(arr) ? arr[arr.length - 1] : undefined),
  isEmpty: (v: unknown) =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0),
  isNotEmpty: (v: unknown) =>
    v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),

  // Type helpers
  typeof: (v: unknown) => typeof v,
  isArray: (v: unknown) => Array.isArray(v),
  isString: (v: unknown) => typeof v === 'string',
  isNumber: (v: unknown) => typeof v === 'number',
  isBool: (v: unknown) => typeof v === 'boolean',

  // Formatting helpers
  json: (v: unknown) => JSON.stringify(v),
}

/**
 * Create an expression context with default helpers
 */
export function createExpressionContext(
  data: Record<string, unknown>,
  additionalHelpers?: Record<string, (...args: unknown[]) => unknown>
): ExpressionContext {
  return {
    data,
    helpers: { ...DEFAULT_HELPERS, ...additionalHelpers },
  }
}
