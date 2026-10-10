/**
 * CustomBlockRegistry
 *
 * Registry for managing custom block definitions.
 *
 * @module @pwfabric/authoring/registry
 *
 * @example
 * ```typescript
 * import { createCustomBlockRegistry, defineBlock } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * const registry = createCustomBlockRegistry()
 *
 * const MyBlock = defineBlock({
 *   type: 'my-block',
 *   name: 'My Block',
 *   schema: z.object({ title: z.string() }),
 *   defaultProps: { title: 'Default' },
 *   component: ({ props }) => <div>{props.title}</div>
 * })
 *
 * registry.register(MyBlock)
 *
 * // Use with SurfaceRenderer
 * <SurfaceRenderer components={registry.getComponents()} />
 * ```
 */

import type { BlockCategory, Block } from '@pwfabric/core'
import type { BlockComponentRegistry } from '@pwfabric/runtime'
import type {
  CustomBlockDefinition,
  ICustomBlockRegistry,
  CustomBlockComponentProps,
  CustomBlockContext,
} from './types.js'
import { createElement, type ReactNode } from 'react'

// ============================================================
// CUSTOM BLOCK REGISTRY
// ============================================================

/**
 * CustomBlockRegistry
 *
 * Manages registration and retrieval of custom block definitions.
 * Provides a bridge between custom block definitions and the
 * SurfaceRenderer component registry.
 */
export class CustomBlockRegistry implements ICustomBlockRegistry {
  private readonly definitions = new Map<string, CustomBlockDefinition>()

  /**
   * Register a custom block definition
   *
   * @param definition - The custom block definition to register
   * @throws Error if block type already registered
   */
  register<TProps extends Record<string, unknown>>(
    definition: CustomBlockDefinition<TProps>
  ): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Block type "${definition.type}" is already registered`)
    }
    this.definitions.set(definition.type, definition as CustomBlockDefinition)
  }

  /**
   * Register multiple custom block definitions
   *
   * @param definitions - Array of custom block definitions
   */
  registerMany(definitions: readonly CustomBlockDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition)
    }
  }

  /**
   * Get a custom block definition by type
   *
   * @param type - Block type identifier
   * @returns The block definition or undefined
   */
  get(type: string): CustomBlockDefinition | undefined {
    return this.definitions.get(type)
  }

  /**
   * Check if a block type is registered
   *
   * @param type - Block type identifier
   * @returns True if registered
   */
  has(type: string): boolean {
    return this.definitions.has(type)
  }

  /**
   * Get all registered custom block definitions
   *
   * @returns Array of all block definitions
   */
  list(): readonly CustomBlockDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Get block definitions by category
   *
   * @param category - Block category
   * @returns Array of block definitions in category
   */
  getByCategory(category: BlockCategory): readonly CustomBlockDefinition[] {
    return this.list().filter((def) => def.category === category)
  }

  /**
   * Get all registered block types
   *
   * @returns Array of block type identifiers
   */
  types(): readonly string[] {
    return Array.from(this.definitions.keys())
  }

  /**
   * Unregister a custom block
   *
   * @param type - Block type identifier
   * @returns True if block was unregistered
   */
  unregister(type: string): boolean {
    return this.definitions.delete(type)
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.definitions.clear()
  }

  /**
   * Get number of registered blocks
   */
  get size(): number {
    return this.definitions.size
  }

  /**
   * Get a component registry for use with SurfaceRenderer
   *
   * This method creates a BlockComponentRegistry that can be passed
   * to the SurfaceRenderer's `components` prop to enable rendering
   * of custom blocks.
   *
   * @returns BlockComponentRegistry with all registered custom blocks
   *
   * @example
   * ```typescript
   * import { SurfaceRenderer } from '@pwfabric/runtime'
   *
   * const registry = createCustomBlockRegistry()
   * registry.register(MyCustomBlock)
   *
   * // Pass to SurfaceRenderer
   * <SurfaceRenderer
   *   surface={mySurface}
   *   components={registry.getComponents()}
   * />
   * ```
   */
  getComponents(): BlockComponentRegistry {
    const components: BlockComponentRegistry = {}

    for (const definition of this.definitions.values()) {
      components[definition.type] = createBlockComponentWrapper(definition)
    }

    return components
  }
}

/**
 * Create a wrapper component that adapts CustomBlockComponent to BlockComponent
 *
 * This bridges the gap between the SDK's CustomBlockComponent interface
 * and the runtime's BlockComponent interface.
 */
/**
 * Map runtime BlockContext to SDK CustomBlockContext
 *
 * Narrows the full runtime context to only what custom block authors need.
 * Excludes: capabilities, imageAdapter, basePath (platform internals).
 */
function mapToCustomBlockContext(runtimeContext: unknown): CustomBlockContext | undefined {
  if (!runtimeContext || typeof runtimeContext !== 'object') return undefined

  const ctx = runtimeContext as Record<string, unknown>
  return {
    theme: (ctx.theme as 'light' | 'dark') ?? 'light',
    viewport: (ctx.viewport as string) ?? 'lg',
    onEvent:
      typeof ctx.onEvent === 'function'
        ? (event: { type: string; blockId?: string; payload?: unknown }) => {
            ;(ctx.onEvent as (e: unknown) => void)(event)
          }
        : undefined,
  }
}

function createBlockComponentWrapper(
  definition: CustomBlockDefinition
): (props: {
  block: Block
  props: Record<string, unknown>
  children?: ReactNode
  context: unknown
}) => ReactNode {
  return function WrappedComponent({
    block,
    props: rawProps,
    children,
    context,
  }: {
    block: Block
    props: Record<string, unknown>
    children?: ReactNode
    context: unknown
  }): ReactNode {
    // Validate and apply defaults using the schema
    const result = definition.schema.safeParse(rawProps)
    const validatedProps = result.success ? result.data : definition.defaultProps

    // Map runtime context to custom block context
    const customContext = mapToCustomBlockContext(context)

    // Create the custom block component props
    const customProps: CustomBlockComponentProps = {
      props: validatedProps,
      blockId: block.id,
      children,
      context: customContext,
    }

    // Render using the custom component
    return createElement(
      definition.component as React.ComponentType<CustomBlockComponentProps>,
      customProps
    )
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a new CustomBlockRegistry
 *
 * @returns A new CustomBlockRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createCustomBlockRegistry()
 * registry.register(MyBlock)
 * ```
 */
export function createCustomBlockRegistry(): CustomBlockRegistry {
  return new CustomBlockRegistry()
}

/**
 * Get a singleton instance of CustomBlockRegistry
 *
 * Use this when you want a shared registry across your application.
 * For isolated registries (e.g., in tests), use `createCustomBlockRegistry()`.
 */
let globalRegistry: CustomBlockRegistry | null = null

export function getCustomBlockRegistry(): CustomBlockRegistry {
  if (!globalRegistry) {
    globalRegistry = new CustomBlockRegistry()
  }
  return globalRegistry
}

/**
 * Reset the global registry
 *
 * Useful for testing or when you need to clear all registrations.
 */
export function resetGlobalRegistry(): void {
  globalRegistry = null
}

// ============================================================
// MERGE UTILITIES
// ============================================================

/**
 * Merge multiple custom block registries into one
 *
 * @param registries - Registries to merge
 * @returns A new registry containing all blocks from input registries
 * @throws Error if there are duplicate block types
 */
export function mergeRegistries(
  ...registries: readonly CustomBlockRegistry[]
): CustomBlockRegistry {
  const merged = new CustomBlockRegistry()

  for (const registry of registries) {
    for (const definition of registry.list()) {
      merged.register(definition)
    }
  }

  return merged
}

/**
 * Merge a custom block registry with a base BlockComponentRegistry
 *
 * This is useful when you want to extend the default block components
 * with custom blocks.
 *
 * @param baseComponents - The base component registry (e.g., defaultBlockComponents)
 * @param customRegistry - The custom block registry
 * @returns A merged BlockComponentRegistry
 */
export function mergeWithBaseComponents(
  baseComponents: BlockComponentRegistry,
  customRegistry: CustomBlockRegistry
): BlockComponentRegistry {
  return {
    ...baseComponents,
    ...customRegistry.getComponents(),
  }
}
