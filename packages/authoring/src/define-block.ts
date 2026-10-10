/**
 * defineBlock API
 *
 * Create type-safe custom block definitions with Zod schemas.
 *
 * @module @pwfabric/authoring/define-block
 *
 * @example
 * ```typescript
 * import { defineBlock } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * export const MyBlock = defineBlock({
 *   type: 'my-block',
 *   name: 'My Block',
 *   schema: z.object({ title: z.string() }),
 *   defaultProps: { title: 'Default' },
 *   component: ({ props }) => <div>{props.title}</div>
 * })
 * ```
 */

import { z, type ZodSchema, type ZodTypeAny } from 'zod'
import { createElement, type ReactNode } from 'react'
import type { CustomBlockOptions, CustomBlockDefinition, SchemaProps } from './types.js'

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate block type identifier
 *
 * Must be kebab-case, 2-50 characters, start with letter.
 */
function validateBlockType(type: string): void {
  if (typeof type !== 'string') {
    throw new Error('Block type must be a string')
  }

  if (type.length < 2 || type.length > 50) {
    throw new Error('Block type must be 2-50 characters')
  }

  const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
  if (!kebabCaseRegex.test(type)) {
    throw new Error(
      `Block type "${type}" must be kebab-case (lowercase letters, numbers, hyphens, starting with a letter)`
    )
  }

  // Reserved types (core block types)
  const reservedTypes = [
    'container',
    'grid',
    'text',
    'heading',
    'button',
    'image',
    'form',
    'input',
    'link',
    'icon',
    'badge',
    'code',
    'divider',
    'list',
    'table',
    'avatar',
    'tooltip',
    'accordion',
    'tabs',
    'dropdown',
    'modal',
  ]

  if (reservedTypes.includes(type)) {
    throw new Error(`Block type "${type}" is reserved. Use a unique type for custom blocks.`)
  }
}

/**
 * field-severity policy — `name` is a COSMETIC display label, NOT the
 * block's identity. It must never be a hard/fatal error: coerce a missing or
 * invalid name to the block `type` and warn. (`type` is the identity and stays
 * HARD — see validateBlockType.) This is the runtime SOFT half of the end-to-end
 * stitch; the authoring/install GATE applies the same policy via
 * validateBlockDefinition() below. Matches the already-tolerant render meta path
 * (installed-block-meta.descriptorToSnapshot), removing the "valid-but-not-
 * renderable" divergence where this throw crashed a block at render.
 */
function coerceBlockName(name: unknown, type: string): string {
  if (typeof name === 'string' && name.length >= 1 && name.length <= 100) {
    return name
  }
  console.warn(
    `[pwfabric] block "${type}": invalid name (${typeof name}) — falling back to type. ` +
      `Names are cosmetic; fix at authoring, never fatal at render.`
  )
  return type
}

/**
 * Warn (never throw) when defaultProps don't satisfy the schema.
 * the renderer degrades, it does not crash. A mismatch is an authoring defect
 * to flag, not a render-time fatality (the registry already falls back to
 * defaultProps on a failed parse).
 */
function warnOnSchemaMismatch(
  type: string,
  schema: ZodSchema<unknown>,
  defaultProps: Record<string, unknown>
): void {
  const result = schema.safeParse(defaultProps)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    console.warn(`[pwfabric] block "${type}": defaultProps do not match schema (${errors}). Fix at authoring.`)
  }
}

/**
 * render-degrade fallback: a block whose `component` is missing must
 * not white-screen the canvas. Render a visible placeholder instead of throwing.
 */
function placeholderComponent(type: string): () => ReactNode {
  return function MissingBlock(): ReactNode {
    return createElement(
      'div',
      {
        'data-pw-placeholder': type,
        style: {
          padding: '8px 12px',
          border: '1px dashed #c0392b',
          borderRadius: '6px',
          color: '#c0392b',
          font: '12px system-ui, sans-serif',
        },
      },
      `Block "${type}" has no component`
    )
  }
}

// ============================================================
// DEFINE BLOCK
// ============================================================

/**
 * Define a custom block with type-safe Zod schema validation
 *
 * Creates a reusable block definition that can be registered with
 * CustomBlockRegistry and used with SurfaceRenderer.
 *
 * @param options - Block definition options
 * @returns A frozen, type-safe custom block definition
 *
 * @example
 * ```typescript
 * import { defineBlock } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * // Define a pricing card block
 * const PricingCard = defineBlock({
 *   type: 'pricing-card',
 *   name: 'Pricing Card',
 *   category: 'content',
 *   schema: z.object({
 *     title: z.string(),
 *     price: z.number(),
 *     currency: z.string().default('USD'),
 *     features: z.array(z.string()),
 *     highlighted: z.boolean().default(false),
 *   }),
 *   defaultProps: {
 *     title: 'Basic Plan',
 *     price: 9.99,
 *     currency: 'USD',
 *     features: ['Feature 1', 'Feature 2'],
 *     highlighted: false,
 *   },
 *   component: ({ props }) => (
 *     <div className={props.highlighted ? 'highlighted' : ''}>
 *       <h3>{props.title}</h3>
 *       <p>{props.currency} {props.price}</p>
 *       <ul>
 *         {props.features.map((f, i) => <li key={i}>{f}</li>)}
 *       </ul>
 *     </div>
 *   ),
 * })
 * ```
 */
export function defineBlock<TSchema extends ZodTypeAny>(
  options: CustomBlockOptions<TSchema>
): CustomBlockDefinition<SchemaProps<TSchema>> {
  type TProps = SchemaProps<TSchema>
  // the renderer DEGRADES, it never throws. `type` is the identity
  // → HARD (throws). Every other required field falls back + warns so a single
  // malformed block can't white-screen the canvas. The authoring/publish gate is
  // where these are rejected early; render stays graceful.
  validateBlockType(options.type)
  const safeName = coerceBlockName(options.name, options.type)

  // schema — missing → passthrough (props pass through unvalidated) + warn.
  let schema = options.schema as ZodSchema<TProps> | undefined
  if (!schema) {
    console.warn(
      `[pwfabric] block "${options.type}": no schema — using a passthrough (props unvalidated). ` +
        `Add a schema at authoring; this is degraded render, not a fix.`
    )
    schema = z.object({}).passthrough() as unknown as ZodSchema<TProps>
  }

  // defaultProps — missing → {} + warn.
  let defaultProps = options.defaultProps
  if (!defaultProps) {
    console.warn(`[pwfabric] block "${options.type}": no defaultProps — using {}.`)
    defaultProps = {} as TProps
  }

  // component — missing → visible placeholder + warn (not a thrown white-screen).
  let component = options.component
  if (typeof component !== 'function') {
    console.warn(`[pwfabric] block "${options.type}": no component — rendering a placeholder.`)
    component = placeholderComponent(options.type) as typeof options.component
  }

  // Defaults vs schema: warn, never throw.
  warnOnSchemaMismatch(options.type, schema, defaultProps)

  // Build the definition with defaults
  const definition = {
    type: options.type,
    name: safeName,
    category: options.category ?? 'content',
    icon: options.icon ?? '◆',
    schema,
    defaultProps,
    canHaveChildren: options.canHaveChildren ?? false,
    component,
    // Only include optional properties if they're defined
    ...(options.allowedChildren !== undefined && { allowedChildren: options.allowedChildren }),
    ...(options.allowedParents !== undefined && { allowedParents: options.allowedParents }),
    ...(options.traits !== undefined && { traits: options.traits }),
    ...(options.allowedChildTraits !== undefined && {
      allowedChildTraits: options.allowedChildTraits,
    }),
    ...(options.maxInstances !== undefined && { maxInstances: options.maxInstances }),
  } as CustomBlockDefinition<TProps>

  // Return a frozen definition to prevent mutations
  return Object.freeze(definition)
}

// ============================================================
// DEFINITION GATE (single-source field policy)
// ============================================================

/** A reported issue from {@link validateBlockDefinition}. */
export interface BlockDefinitionIssue {
  field: 'type' | 'name'
  code: string
  severity: 'error' | 'warning'
  message: string
}

/**
 * Single source of truth for block-definition field severity, used by
 * the AUTHORING / INSTALL gate (packaging, manifest validation, host
 * install). Non-throwing reporter — the SAME stitch defineBlock applies at
 * runtime, surfaced as structured issues so callers can REJECT identity
 * problems (`type`, severity=error) and merely WARN on cosmetic ones (`name`,
 * severity=warning). Keeping this the one place the policy lives is what makes
 * the treatment identical end-to-end (authoring → install → runtime → render).
 */
export function validateBlockDefinition(options: { type?: unknown; name?: unknown }): BlockDefinitionIssue[] {
  const issues: BlockDefinitionIssue[] = []
  // type — block IDENTITY → HARD (error). Mirrors validateBlockType's rules.
  const t = options.type
  if (typeof t !== 'string') {
    issues.push({ field: 'type', code: 'BLOCK_TYPE_NOT_STRING', severity: 'error', message: 'Block type must be a string' })
  } else if (t.length < 2 || t.length > 50) {
    issues.push({ field: 'type', code: 'BLOCK_TYPE_LENGTH', severity: 'error', message: 'Block type must be 2-50 characters' })
  } else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(t)) {
    issues.push({ field: 'type', code: 'BLOCK_TYPE_FORMAT', severity: 'error', message: `Block type "${t}" must be kebab-case` })
  }
  // name — cosmetic label → SOFT (warning). Never blocks; coerced to type at runtime.
  const n = options.name
  if (typeof n !== 'string' || n.length < 1 || n.length > 100) {
    issues.push({ field: 'name', code: 'BLOCK_NAME_INVALID', severity: 'warning', message: 'Block name should be a 1-100 char string; falls back to type' })
  }
  return issues
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Check if a value is a custom block definition
 */
export function isCustomBlockDefinition(value: unknown): value is CustomBlockDefinition {
  if (!value || typeof value !== 'object') {
    return false
  }

  const def = value as Partial<CustomBlockDefinition>
  return (
    typeof def.type === 'string' &&
    typeof def.name === 'string' &&
    typeof def.category === 'string' &&
    typeof def.schema === 'object' &&
    typeof def.defaultProps === 'object' &&
    typeof def.component === 'function'
  )
}

/**
 * Create a block instance from a custom block definition
 *
 * @param definition - The block definition
 * @param id - Unique block ID
 * @param props - Optional props override (merged with defaults)
 * @param children - Optional children blocks
 */
export function createBlockInstance<TProps extends Record<string, unknown>>(
  definition: CustomBlockDefinition<TProps>,
  id: string,
  props?: Partial<TProps>,
  children?: readonly { id: string; type: string; props: Record<string, unknown> }[]
): { id: string; type: string; props: TProps; children?: typeof children } {
  const mergedProps = {
    ...definition.defaultProps,
    ...props,
  } as TProps

  // Validate merged props
  const result = definition.schema.safeParse(mergedProps)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new Error(`Invalid block props: ${errors}`)
  }

  const instance: { id: string; type: string; props: TProps; children?: typeof children } = {
    id,
    type: definition.type,
    props: result.data as TProps,
  }

  if (children && children.length > 0) {
    if (!definition.canHaveChildren) {
      throw new Error(`Block type "${definition.type}" cannot have children`)
    }
    instance.children = children
  }

  return instance
}
