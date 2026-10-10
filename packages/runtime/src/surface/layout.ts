/**
 * Layout System
 *
 * Slot and layout resolution for surfaces
 *
 * The layout system handles:
 * - Slot resolution (named slots with fallback content)
 * - Layout composition (nesting surfaces)
 * - Conditional rendering
 * - Loop expansion
 *
 * @module @pwfabric/runtime/surface/layout
 */

import type { RenderNode, RenderContext, LayoutJSON } from './types.js'
import { createNode, createChildContext } from './types.js'
import {
  evaluate,
  createExpressionContext,
  type ExpressionContext,
  type ExpressionResult,
} from './expression.js'
import { isPrimitive } from './primitives.js'

// ============================================================
// LAYOUT RESOLUTION
// ============================================================

/**
 * Layout resolution result
 */
export type LayoutResult =
  | { readonly success: true; readonly nodes: readonly RenderNode[] }
  | { readonly success: false; readonly error: string }

/**
 * Resolve a layout definition into render nodes
 */
export function resolveLayout(layout: LayoutJSON, context: RenderContext): LayoutResult {
  const exprContext = createExpressionContext(context.data)

  return resolveLayoutNode(layout, context, exprContext)
}

/**
 * Resolve a single layout node
 */
function resolveLayoutNode(
  layout: LayoutJSON,
  context: RenderContext,
  exprContext: ExpressionContext
): LayoutResult {
  // Handle conditional rendering
  if (layout.if) {
    const condResult = evaluate(layout.if, exprContext)
    if (!condResult.success) {
      return { success: false, error: `Condition error: ${condResult.error}` }
    }
    if (!condResult.value) {
      // Condition is false, render nothing
      return { success: true, nodes: [] }
    }
  }

  // Handle loop expansion
  if (layout.each) {
    return resolveLoop(layout, context, exprContext)
  }

  // Handle slot
  if (layout.slot) {
    return resolveSlot(layout, context, exprContext)
  }

  // Handle primitive or custom component
  return resolvePrimitive(layout, context, exprContext)
}

/**
 * Resolve a loop layout into multiple nodes
 */
function resolveLoop(
  layout: LayoutJSON,
  context: RenderContext,
  exprContext: ExpressionContext
): LayoutResult {
  const { each } = layout
  if (!each) {
    return { success: false, error: 'Loop layout missing each config' }
  }

  const itemsResult = evaluate(each.items, exprContext)
  if (!itemsResult.success) {
    return { success: false, error: `Loop items error: ${itemsResult.error}` }
  }

  const items = itemsResult.value
  if (!Array.isArray(items)) {
    return { success: false, error: `Loop items must be an array, got ${typeof items}` }
  }

  const nodes: RenderNode[] = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]

    // Create child context with loop variables
    const loopData: Record<string, unknown> = {
      [each.as]: item,
      [`${each.as}Index`]: index,
      [`${each.as}First`]: index === 0,
      [`${each.as}Last`]: index === items.length - 1,
    }

    const childContext = createChildContext(context, loopData)
    const childExprContext = createExpressionContext({ ...exprContext.data, ...loopData })

    // Generate key
    let key: string
    if (each.key) {
      const keyResult = evaluate(each.key, childExprContext)
      key = keyResult.success ? String(keyResult.value) : `loop-${index}`
    } else {
      key = `loop-${index}`
    }

    // Resolve children for this iteration
    if (layout.children) {
      for (const child of layout.children) {
        const childResult = resolveLayoutNode(child, childContext, childExprContext)
        if (!childResult.success) {
          return childResult
        }
        // Add key to each child
        for (const node of childResult.nodes) {
          nodes.push(createNode(node.type, { ...node.props, key }, node.children))
        }
      }
    }
  }

  return { success: true, nodes }
}

/**
 * Resolve a slot layout
 */
function resolveSlot(
  layout: LayoutJSON,
  context: RenderContext,
  exprContext: ExpressionContext
): LayoutResult {
  const slotName = layout.slot
  if (!slotName) {
    return { success: false, error: 'Slot layout missing slot name' }
  }
  const slotContent = context.slots.get(slotName)

  if (slotContent && slotContent.length > 0) {
    // Slot has content, use it
    return { success: true, nodes: slotContent }
  }

  // No slot content, use fallback (children)
  if (layout.children) {
    const nodes: RenderNode[] = []
    for (const child of layout.children) {
      const childResult = resolveLayoutNode(child, context, exprContext)
      if (!childResult.success) {
        return childResult
      }
      nodes.push(...childResult.nodes)
    }
    return { success: true, nodes }
  }

  // No fallback either
  return { success: true, nodes: [] }
}

/**
 * Resolve a primitive or custom component
 */
function resolvePrimitive(
  layout: LayoutJSON,
  context: RenderContext,
  exprContext: ExpressionContext
): LayoutResult {
  const { type, props = {}, children = [] } = layout

  // Resolve props (evaluate expressions in prop values)
  const resolvedProps: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      // Expression prop
      const expr = value.slice(2, -2).trim()
      const result = evaluate(expr, exprContext)
      if (!result.success) {
        return { success: false, error: `Prop ${key} expression error: ${result.error}` }
      }
      resolvedProps[key] = result.value
    } else if (typeof value === 'string' && value.includes('{{')) {
      // Template string with interpolation
      const result = interpolateString(value, exprContext)
      if (!result.success) {
        return { success: false, error: `Prop ${key} interpolation error: ${result.error}` }
      }
      resolvedProps[key] = result.value
    } else {
      resolvedProps[key] = value
    }
  }

  // Resolve children recursively
  const resolvedChildren: RenderNode[] = []
  for (const child of children) {
    const childResult = resolveLayoutNode(child, context, exprContext)
    if (!childResult.success) {
      return childResult
    }
    resolvedChildren.push(...childResult.nodes)
  }

  // Validate primitive type
  if (!isPrimitive(type) && !type.includes(':')) {
    // Unknown type - could be a custom component, let it pass
  }

  const node = createNode(type, resolvedProps, resolvedChildren)
  return { success: true, nodes: [node] }
}

/**
 * Interpolate a string with expressions
 */
function interpolateString(
  template: string,
  exprContext: ExpressionContext
): ExpressionResult<string> {
  const pattern = /\{\{(.+?)\}\}/g
  let result = template
  let match: RegExpExecArray | null

  // Need to reset lastIndex since we're using the regex multiple times
  pattern.lastIndex = 0

  const replacements: { from: string; to: string }[] = []

  while ((match = pattern.exec(template)) !== null) {
    const placeholder = match[0]
    const expression = match[1]
    if (!expression) continue
    const evalResult = evaluate(expression.trim(), exprContext)
    if (!evalResult.success) {
      return { success: false, error: evalResult.error }
    }
    replacements.push({ from: placeholder, to: String(evalResult.value ?? '') })
  }

  for (const { from, to } of replacements) {
    result = result.replace(from, to)
  }

  return { success: true, value: result }
}

// ============================================================
// SLOT MANAGEMENT
// ============================================================

/**
 * Create a slot map from slot content
 */
export function createSlotMap(
  slots: Record<string, readonly RenderNode[]>
): Map<string, readonly RenderNode[]> {
  return new Map(Object.entries(slots))
}

/**
 * Extract slots from children based on slot attribute
 */
export function extractSlots(children: readonly RenderNode[]): {
  default: readonly RenderNode[]
  named: Map<string, readonly RenderNode[]>
} {
  const defaultSlot: RenderNode[] = []
  const namedSlots = new Map<string, RenderNode[]>()

  for (const child of children) {
    const slotName = child.props.slot as string | undefined
    if (slotName) {
      const existing = namedSlots.get(slotName) ?? []
      existing.push(child)
      namedSlots.set(slotName, existing)
    } else {
      defaultSlot.push(child)
    }
  }

  return { default: defaultSlot, named: namedSlots }
}

// ============================================================
// LAYOUT COMPOSITION
// ============================================================

/**
 * Compose multiple layouts into one
 */
export function composeLayouts(
  layouts: readonly LayoutJSON[],
  context: RenderContext
): LayoutResult {
  const nodes: RenderNode[] = []

  for (const layout of layouts) {
    const result = resolveLayout(layout, context)
    if (!result.success) {
      return result
    }
    nodes.push(...result.nodes)
  }

  return { success: true, nodes }
}

/**
 * Wrap nodes in a container
 */
export function wrapInContainer(
  nodes: readonly RenderNode[],
  props?: Record<string, unknown>
): RenderNode {
  return createNode('container', props ?? {}, nodes)
}

// ============================================================
// LAYOUT VALIDATION
// ============================================================

/**
 * Validate a layout definition
 */
export function validateLayout(layout: LayoutJSON): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Must have a type
  if (!layout.type) {
    errors.push('Layout must have a type')
  }

  // Validate each config
  if (layout.each) {
    if (!layout.each.items) {
      errors.push('Loop layout must have items expression')
    }
    if (!layout.each.as) {
      errors.push('Loop layout must have as variable name')
    }
  }

  // Validate children recursively
  if (layout.children) {
    for (let i = 0; i < layout.children.length; i++) {
      const child = layout.children[i]
      if (!child) continue
      const childResult = validateLayout(child)
      if (!childResult.valid) {
        errors.push(...childResult.errors.map((e) => `children[${i}]: ${e}`))
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
