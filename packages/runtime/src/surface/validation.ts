/**
 * Block Props Validation
 *
 * Runtime validation of block props using injected Zod schemas.
 * the legacy `blockSchemas` map is gone — production
 * callers supply a schema map sourced from the install pipeline (per-atom
 * `manifest.definition.props[*].jsonSchema` rebuilt into Zod). Without a
 * schema map the validator runs in lenient mode and passes everything
 * through.
 *
 * @module @pwfabric/runtime/surface/validation
 */

import type { ZodSchema } from 'zod'

/** Map of block type → Zod schema. Supply via options to enable strict checks. */
export type BlockSchemaMap = Readonly<Record<string, ZodSchema>>

// ============================================================
// VALIDATION TYPES
// ============================================================

/**
 * Options for block props validation
 */
export interface BlockPropsValidationOptions {
  /**
   * When true, unknown block types cause validation failure.
   * When false (default), unknown block types pass through.
   */
  readonly strict?: boolean
  /**
   * Per-block-type Zod schemas. the runtime no longer
   * ships a built-in schema map — callers that want prop validation
   * supply their own (typically rebuilt from
   * each installed block manifest's `definition.props[*].jsonSchema`).
   * Omitting the map yields lenient pass-through behaviour.
   */
  readonly schemas?: BlockSchemaMap
  /**
   * Per-block-type manifest props. When supplied, props a manifest
   * does not declare and templates on `bindable: false` props are reported as
   * WARNINGS (`manifestPropFindings`); they never fail validation.
   */
  readonly manifests?: BlockManifestPropsMap
}

/**
 * Result of validating block props against the schema
 */
export interface BlockPropsValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly coerced?: Record<string, unknown>
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

/**
 * Validate block props against the known Zod schema for the given block type.
 *
 * - Known block types are validated against the schema from @pwfabric/core.
 * - Unknown block types pass through in lenient mode (default) and fail in strict mode.
 * - On success, returns coerced data (with defaults applied by Zod).
 */
export function validateBlockProps(
  type: string,
  props: Record<string, unknown>,
  options: BlockPropsValidationOptions = {}
): BlockPropsValidationResult {
  const { strict = false, schemas } = options

  const schema = schemas?.[type]

  if (!schema) {
    if (strict) {
      return {
        valid: false,
        errors: [`Unknown block type: ${type}`],
      }
    }
    // Lenient mode: unknown / unsupplied types pass through
    return { valid: true, errors: [] }
  }

  const result = schema.safeParse(props)

  if (result.success) {
    return {
      valid: true,
      errors: [],
      coerced: result.data as Record<string, unknown>,
    }
  }

  return {
    valid: false,
    errors: result.error.issues.map(
      (i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`
    ),
  }
}

/**
 * Layout node shape for recursive validation.
 * Matches LayoutJSON structure without importing it to avoid circular deps.
 */
interface LayoutNode {
  readonly type: string
  readonly props?: Record<string, unknown>
  readonly children?: readonly LayoutNode[]
}

/**
 * A single validation issue with path context
 */
export interface LayoutPropsIssue {
  readonly path: string
  readonly type: string
  readonly errors: readonly string[]
}

/**
 * Validate all block props in a layout tree recursively.
 *
 * Returns a flat list of validation issues with path context.
 */
export function validateLayoutProps(
  layout: LayoutNode,
  options: BlockPropsValidationOptions = {},
  path = 'root'
): readonly LayoutPropsIssue[] {
  const issues: LayoutPropsIssue[] = []

  const result = validateBlockProps(layout.type, layout.props ?? {}, options)
  if (!result.valid) {
    issues.push({
      path,
      type: layout.type,
      errors: result.errors,
    })
  }

  if (layout.children) {
    for (let i = 0; i < layout.children.length; i++) {
      const child = layout.children[i]
      if (child) {
        const childIssues = validateLayoutProps(child, options, `${path}.children[${i}]`)
        issues.push(...childIssues)
      }
    }
  }

  return issues
}

// ============================================================
// PACK MANIFEST ENFORCEMENT
// ============================================================

/**
 * One prop a pack manifest declares: `manifest.definition.props[*]`. Only the
 * two fields the check reads; a full manifest entry passes as it is.
 */
export interface ManifestPropSpec {
  readonly name: string
  /** `false` = the prop takes a literal only; a `{{ }}` template is not resolved for it. */
  readonly bindable?: boolean
}

/** Block type → the props its manifest declares. */
export type BlockManifestPropsMap = Readonly<Record<string, readonly ManifestPropSpec[]>>

export type ManifestPropFindingCode = 'UNKNOWN_PROP' | 'TEMPLATE_ON_UNBINDABLE'

/**
 * A prop that does not match its block's manifest. Always a WARNING:
 * existing apps carry such props and must keep rendering; a caller
 * decides whether to show, count or (later) refuse them.
 */
export interface ManifestPropFinding {
  readonly path: string
  readonly type: string
  readonly prop: string
  readonly code: ManifestPropFindingCode
  readonly severity: 'warning'
  readonly message: string
}

function carriesTemplate(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof value === 'string') return value.includes('{{')
  if (Array.isArray(value)) return value.some((v) => carriesTemplate(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => carriesTemplate(v, depth + 1))
  }
  return false
}

/**
 * The props of ONE block that its manifest does not allow.
 *
 * WHY: a prop the manifest does not declare was
 * accepted silently. The schema check rebuilds each prop's JSON schema into a
 * passthrough object, so a misspelt or invented prop (`tone` on a block that
 * has none, `paddingY` where the block reads `padding`) validated clean and
 * did nothing on screen. And a `{{ }}` template on a `bindable: false` prop was
 * shown to the visitor as literal braces. Both are now named.
 *
 * @param specs the block's declared props; `undefined` (block not in the map)
 *   yields nothing, because an unknown block type is a different finding.
 */
export function blockManifestPropFindings(
  type: string,
  props: Record<string, unknown> | undefined,
  specs: readonly ManifestPropSpec[] | undefined,
  path = 'root'
): ManifestPropFinding[] {
  if (!specs || !props) return []
  const byName = new Map(specs.map((s) => [s.name, s]))
  const out: ManifestPropFinding[] = []
  for (const [prop, value] of Object.entries(props)) {
    if (value === undefined) continue
    const spec = byName.get(prop)
    if (!spec) {
      out.push({
        path,
        type,
        prop,
        code: 'UNKNOWN_PROP',
        severity: 'warning',
        message: `"${prop}" is not a prop of ${type}; the block ignores it.`,
      })
      continue
    }
    if (spec.bindable === false && carriesTemplate(value)) {
      out.push({
        path,
        type,
        prop,
        code: 'TEMPLATE_ON_UNBINDABLE',
        severity: 'warning',
        message: `"${prop}" on ${type} takes a literal value; its {{ }} template is shown as written.`,
      })
    }
  }
  return out
}

/**
 * Every manifest finding in a layout tree, with path context. Blocks whose
 * type is not in `manifests` are skipped.
 */
export function manifestPropFindings(
  layout: LayoutNode,
  manifests: BlockManifestPropsMap,
  path = 'root'
): ManifestPropFinding[] {
  const out = blockManifestPropFindings(layout.type, layout.props, manifests[layout.type], path)
  if (layout.children) {
    layout.children.forEach((child, i) => {
      if (child) out.push(...manifestPropFindings(child, manifests, `${path}.children[${i}]`))
    })
  }
  return out
}
