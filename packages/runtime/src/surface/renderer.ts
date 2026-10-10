/**
 * Surface Renderer
 *
 * Deterministic surface rendering engine
 *
 * The renderer takes an interpreted surface and produces a render tree.
 * Rendering is deterministic: same input + context = same output.
 *
 * INVARIANTS:
 * - Rendering is pure (no side effects)
 * - Same input always produces same output
 * - Render order is deterministic
 * - All expressions are evaluated synchronously
 *
 * @module @pwfabric/runtime/surface/renderer
 */

import type { SurfaceId } from '@pwfabric/contracts'
import type {
  RenderNode,
  RenderContext,
  RenderResult,
  RenderOutput,
  RenderError,
  LayoutJSON,
} from './types.js'
import { createRenderContext, renderSuccess, renderError, createNode } from './types.js'
import { resolveLayout, type LayoutResult } from './layout.js'
import type { InterpretedSurface } from './interpreter.js'

// ============================================================
// RENDERER INTERFACE
// ============================================================

/**
 * Surface renderer options
 */
export interface RenderOptions {
  readonly data?: Record<string, unknown>
  readonly slots?: Record<string, readonly RenderNode[]>
  readonly strict?: boolean
}

/**
 * Surface renderer
 */
export interface SurfaceRenderer {
  /**
   * Render an interpreted surface
   */
  render(surface: InterpretedSurface, options?: RenderOptions): RenderResult

  /**
   * Render a layout directly
   */
  renderLayout(layout: LayoutJSON, context: RenderContext): LayoutResult
}

// ============================================================
// DETERMINISTIC RENDERER
// ============================================================

/**
 * Deterministic surface renderer implementation
 *
 * This renderer guarantees:
 * - Same input produces same output
 * - No hidden state or side effects
 * - Predictable ordering
 */
export class DeterministicRenderer implements SurfaceRenderer {
  render(surface: InterpretedSurface, options: RenderOptions = {}): RenderResult {
    const startTime = performance.now()

    // Create render context
    const context = createRenderContext({
      surfaceId: surface.id,
      bindings: surface.bindings,
      data: options.data ?? {},
      slots: options.slots ? new Map(Object.entries(options.slots)) : new Map(),
    })

    // Resolve layout to render nodes
    const layoutResult = resolveLayout(surface.layout, context)

    if (!layoutResult.success) {
      return renderError({
        type: 'layout_error',
        message: layoutResult.error,
      })
    }

    // Build root node
    const root = createRootNode(surface.id, layoutResult.nodes)
    const nodeCount = countNodes(root)
    const renderTime = performance.now() - startTime

    const output: RenderOutput = {
      surfaceId: surface.id,
      root,
      metadata: {
        renderTime,
        nodeCount,
        bindings: Array.from(surface.bindings.keys()),
      },
    }

    return renderSuccess(output)
  }

  renderLayout(layout: LayoutJSON, context: RenderContext): LayoutResult {
    return resolveLayout(layout, context)
  }
}

/**
 * Create a root container node
 */
function createRootNode(surfaceId: SurfaceId, children: readonly RenderNode[]): RenderNode {
  return createNode(
    'fragment',
    {
      'data-surface-id': surfaceId,
      'data-surface-root': true,
    },
    children
  )
}

/**
 * Count total nodes in a tree
 */
function countNodes(node: RenderNode): number {
  let count = 1
  for (const child of node.children) {
    count += countNodes(child)
  }
  return count
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a new surface renderer
 */
export function createRenderer(): SurfaceRenderer {
  return new DeterministicRenderer()
}

// ============================================================
// RENDER HELPERS
// ============================================================

/**
 * Render a surface to a render tree
 */
export function renderSurface(surface: InterpretedSurface, options?: RenderOptions): RenderResult {
  const renderer = createRenderer()
  return renderer.render(surface, options)
}

/**
 * Check if a render result is successful
 */
export function isRenderSuccess(
  result: RenderResult
): result is { success: true; output: RenderOutput } {
  return result.success
}

/**
 * Check if a render result is a failure
 */
export function isRenderError(
  result: RenderResult
): result is { success: false; error: RenderError } {
  return !result.success
}

// ============================================================
// SERIALIZATION
// ============================================================

/**
 * Serialize a render node to JSON
 */
export function serializeNode(node: RenderNode): object {
  return {
    type: node.type,
    props: node.props,
    children: node.children.map(serializeNode),
  }
}

/**
 * Serialize render output to JSON
 */
export function serializeOutput(output: RenderOutput): object {
  return {
    surfaceId: output.surfaceId,
    root: serializeNode(output.root),
    metadata: output.metadata,
  }
}

// ============================================================
// HASH FOR DETERMINISM VERIFICATION
// ============================================================

/**
 * Compute a hash of a render node for determinism verification
 *
 * Same input should always produce same hash
 */
export function hashNode(node: RenderNode): string {
  const parts: string[] = [node.type]

  // Add sorted props
  const propKeys = Object.keys(node.props).sort()
  for (const key of propKeys) {
    const value = node.props[key]
    parts.push(`${key}=${JSON.stringify(value)}`)
  }

  // Add child hashes
  for (const child of node.children) {
    parts.push(hashNode(child))
  }

  return simpleHash(parts.join('|'))
}

/**
 * Simple string hash (djb2)
 */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Verify determinism by rendering twice and comparing hashes
 */
export function verifyDeterminism(
  surface: InterpretedSurface,
  options?: RenderOptions
): { deterministic: boolean; hash1: string; hash2: string } {
  const renderer = createRenderer()

  const result1 = renderer.render(surface, options)
  const result2 = renderer.render(surface, options)

  if (!result1.success || !result2.success) {
    return { deterministic: false, hash1: 'error', hash2: 'error' }
  }

  const hash1 = hashNode(result1.output.root)
  const hash2 = hashNode(result2.output.root)

  return {
    deterministic: hash1 === hash2,
    hash1,
    hash2,
  }
}
