/**
 * Surface Rendering Types
 *
 * Internal types for surface rendering pipeline
 *
 * @module @pwfabric/runtime/surface/types
 */

import type { CapabilityId, SurfaceId } from '@pwfabric/contracts'

// ============================================================
// RENDER NODE TYPES
// ============================================================

/**
 * Primitive types supported by the runtime
 */
export type PrimitiveType =
  | 'text'
  | 'container'
  | 'button'
  | 'input'
  | 'image'
  | 'link'
  | 'list'
  | 'list-item'
  | 'divider'
  | 'spacer'
  | 'heading'
  | 'paragraph'
  | 'slot'
  | 'fragment'
  | 'conditional'
  | 'loop'

/**
 * Base properties shared by all render nodes
 */
export interface BaseNodeProps {
  readonly id?: string
  readonly key?: string
  readonly className?: string
  readonly style?: Record<string, string | number>
  readonly data?: Record<string, unknown>
}

/**
 * Render node - the output of surface rendering
 */
export interface RenderNode {
  readonly type: PrimitiveType | string
  readonly props: BaseNodeProps & Record<string, unknown>
  readonly children: readonly RenderNode[]
}

/**
 * Create a render node
 */
export function createNode(
  type: PrimitiveType | string,
  props: BaseNodeProps & Record<string, unknown> = {},
  children: readonly RenderNode[] = []
): RenderNode {
  return { type, props, children }
}

// ============================================================
// SURFACE JSON SCHEMA
// ============================================================

/**
 * Surface JSON definition (input format)
 */
export interface SurfaceJSON {
  readonly $schema?: string
  readonly id: string
  readonly version: string
  readonly environment: string
  readonly metadata?: {
    readonly name?: string
    readonly description?: string
    readonly tags?: readonly string[]
  }
  readonly bindings?: readonly BindingJSON[]
  readonly layout: LayoutJSON
}

/**
 * Capability binding in JSON
 */
export interface BindingJSON {
  readonly capability: string
  readonly alias?: string
  readonly transform?: {
    readonly input?: Record<string, unknown>
    readonly output?: Record<string, unknown>
  }
}

/**
 * Layout definition in JSON
 */
export interface LayoutJSON {
  readonly type: PrimitiveType | string
  readonly props?: Record<string, unknown>
  readonly children?: readonly LayoutJSON[]
  readonly slot?: string
  readonly if?: string
  readonly each?: {
    readonly items: string
    readonly as: string
    readonly key?: string
  }
}

// ============================================================
// RENDER CONTEXT
// ============================================================

/**
 * Context passed during rendering
 */
export interface RenderContext {
  readonly surfaceId: SurfaceId
  readonly bindings: Map<string, CapabilityId>
  readonly data: Record<string, unknown>
  readonly slots: Map<string, readonly RenderNode[]>
  readonly parent?: RenderContext
}

/**
 * Create a render context
 */
export function createRenderContext(options: {
  surfaceId: SurfaceId
  bindings?: Map<string, CapabilityId>
  data?: Record<string, unknown>
  slots?: Map<string, readonly RenderNode[]>
  parent?: RenderContext
}): RenderContext {
  const result: RenderContext = {
    surfaceId: options.surfaceId,
    bindings: options.bindings ?? new Map(),
    data: options.data ?? {},
    slots: options.slots ?? new Map(),
  }
  if (options.parent) {
    return { ...result, parent: options.parent }
  }
  return result
}

/**
 * Create a child context with additional data
 */
export function createChildContext(
  parent: RenderContext,
  additionalData: Record<string, unknown>
): RenderContext {
  return {
    ...parent,
    data: { ...parent.data, ...additionalData },
    parent,
  }
}

// ============================================================
// RENDER RESULT
// ============================================================

/**
 * Result of rendering a surface
 */
export type RenderResult =
  | { readonly success: true; readonly output: RenderOutput }
  | { readonly success: false; readonly error: RenderError }

/**
 * Render output
 */
export interface RenderOutput {
  readonly surfaceId: SurfaceId
  readonly root: RenderNode
  readonly metadata: {
    readonly renderTime: number
    readonly nodeCount: number
    readonly bindings: readonly string[]
  }
}

/**
 * Formalized error code vocabulary for render errors
 */
export type RenderErrorCode =
  | 'invalid_surface'
  | 'missing_binding'
  | 'layout_error'
  | 'slot_error'
  | 'expression_error'

/**
 * Render error types
 */
export type RenderError =
  | {
      readonly type: 'invalid_surface'
      readonly message: string
      readonly details?: Record<string, unknown>
    }
  | {
      readonly type: 'missing_binding'
      readonly binding: string
      readonly details?: Record<string, unknown>
    }
  | {
      readonly type: 'layout_error'
      readonly message: string
      readonly details?: Record<string, unknown>
    }
  | {
      readonly type: 'slot_error'
      readonly slot: string
      readonly message: string
      readonly details?: Record<string, unknown>
    }
  | {
      readonly type: 'expression_error'
      readonly expression: string
      readonly message: string
      readonly details?: Record<string, unknown>
    }

/**
 * Create a successful render result
 */
export function renderSuccess(output: RenderOutput): RenderResult {
  return { success: true, output }
}

/**
 * Create a failed render result
 */
export function renderError(error: RenderError): RenderResult {
  return { success: false, error }
}
