/**
 * @pwfabric/authoring Type Definitions
 *
 * Core type definitions for the Custom Block SDK.
 *
 * @module @pwfabric/authoring/types
 */

import type { ZodSchema, ZodTypeDef } from 'zod'
import type { Block, BlockCategory } from '@pwfabric/core'
import type { BlockComponentRegistry } from '@pwfabric/runtime'
import type { ReactNode } from 'react'

// ============================================================
// CUSTOM BLOCK DEFINITION
// ============================================================

/**
 * Custom block definition options
 *
 * Used with `defineBlock()` to create a type-safe custom block.
 */
export interface CustomBlockOptions<
  TProps extends Record<string, unknown> = Record<string, unknown>,
  TSchema extends ZodSchema<TProps, ZodTypeDef, unknown> = ZodSchema<TProps>,
> {
  /** Unique block type identifier (kebab-case) */
  readonly type: string

  /** Human-readable display name */
  readonly name: string

  /** Block category for grouping */
  readonly category?: BlockCategory

  /** Icon character or identifier */
  readonly icon?: string

  /** Zod schema for props validation */
  readonly schema: TSchema

  /** Default props for new instances */
  readonly defaultProps: TProps

  /** Whether this block can contain children */
  readonly canHaveChildren?: boolean

  /** Restrict which block types can be children */
  readonly allowedChildren?: readonly string[]

  /** Restrict which block types can be parents */
  readonly allowedParents?: readonly string[]

  /** open trait vocabulary this block carries (kebab-case). */
  readonly traits?: readonly string[]

  /** children must carry ANY of these traits (containers only). */
  readonly allowedChildTraits?: readonly string[]

  /** Maximum instances allowed in a surface */
  readonly maxInstances?: number

  /** React component to render this block */
  readonly component: CustomBlockComponent<TProps>
}

/**
 * Custom block context
 *
 * Narrowed view of the runtime BlockContext for custom block authors.
 * Excludes platform internals (capabilities, imageAdapter, basePath).
 */
export interface CustomBlockContext {
  /** Current theme */
  readonly theme: 'light' | 'dark'
  /** Current viewport breakpoint */
  readonly viewport: string
  /** Event handler for block-level events */
  readonly onEvent?:
    | ((event: { type: string; blockId?: string; payload?: unknown }) => void)
    | undefined
}

/**
 * Custom block component props
 */
export interface CustomBlockComponentProps<TProps = Record<string, unknown>> {
  /** The resolved, type-safe props */
  readonly props: TProps
  /** Block ID */
  readonly blockId: string
  /** Rendered children (for container blocks) */
  readonly children?: ReactNode
  /** Runtime context (theme, viewport, events) */
  readonly context?: CustomBlockContext | undefined
}

/**
 * Custom block component type
 */
export type CustomBlockComponent<TProps = Record<string, unknown>> = (
  props: CustomBlockComponentProps<TProps>
) => ReactNode

/**
 * Custom block definition (result of defineBlock)
 *
 * Contains both the block metadata and the component for rendering.
 */
export interface CustomBlockDefinition<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique block type identifier */
  readonly type: string

  /** Human-readable display name */
  readonly name: string

  /** Block category */
  readonly category: BlockCategory

  /** Icon character or identifier */
  readonly icon: string

  /** Zod schema for validation */
  readonly schema: ZodSchema<TProps>

  /** Default props */
  readonly defaultProps: TProps

  /** Whether this block can contain children */
  readonly canHaveChildren: boolean

  /** Allowed child block types */
  readonly allowedChildren?: readonly string[]

  /** Allowed parent block types */
  readonly allowedParents?: readonly string[]

  /** open trait vocabulary this block carries (kebab-case). */
  readonly traits?: readonly string[]

  /** children must carry ANY of these traits (containers only). */
  readonly allowedChildTraits?: readonly string[]

  /** Maximum instances */
  readonly maxInstances?: number

  /** React component */
  readonly component: CustomBlockComponent<TProps>
}

// ============================================================
// FACTORY DEFINITION
// ============================================================

/**
 * Factory configuration input
 *
 * Passed to the build function to customize the generated blocks.
 */
export type FactoryConfig = Record<string, unknown>

/**
 * Block specification for factory output
 *
 * Simplified block definition without requiring an id (auto-generated).
 */
export interface BlockSpec {
  /** Block type */
  readonly type: string
  /** Block props */
  readonly props: Record<string, unknown>
  /** Nested children */
  readonly children?: readonly BlockSpec[]
}

/**
 * Factory definition options
 *
 * Used with `defineFactory()` to create a factory function.
 */
export interface FactoryOptions<TConfig extends FactoryConfig = FactoryConfig> {
  /** Unique factory identifier (kebab-case) */
  readonly id: string

  /** Human-readable factory name */
  readonly name?: string

  /** Factory description */
  readonly description?: string

  /** Optional Zod schema for config validation */
  readonly configSchema?: ZodSchema<TConfig>

  /** Build function that returns block specifications */
  readonly build: (config: TConfig) => readonly BlockSpec[]
}

/**
 * Factory definition (result of defineFactory)
 */
export interface FactoryDefinition<TConfig extends FactoryConfig = FactoryConfig> {
  /** Factory identifier */
  readonly id: string

  /** Factory name */
  readonly name: string

  /** Factory description */
  readonly description: string

  /** Config schema (if provided) */
  readonly configSchema?: ZodSchema<TConfig>

  /** Build function */
  readonly build: (config: TConfig) => readonly Block[]

  /** Validate config against schema (if provided) */
  readonly validateConfig: (config: unknown) => FactoryValidationResult<TConfig>
}

/**
 * Factory validation result
 */
export interface FactoryValidationResult<TConfig = FactoryConfig> {
  /** Whether validation passed */
  readonly valid: boolean
  /** Validated config (if valid) */
  readonly config?: TConfig
  /** Validation errors (if invalid) */
  readonly errors?: readonly FactoryValidationError[]
}

/**
 * Factory validation error
 */
export interface FactoryValidationError {
  /** Error path in the config */
  readonly path: string
  /** Error message */
  readonly message: string
}

// ============================================================
// REGISTRY TYPES
// ============================================================

/**
 * Custom block registry interface
 */
export interface ICustomBlockRegistry {
  /**
   * Register a custom block definition
   */
  register<TProps extends Record<string, unknown>>(definition: CustomBlockDefinition<TProps>): void

  /**
   * Get a custom block definition by type
   */
  get(type: string): CustomBlockDefinition | undefined

  /**
   * Check if a block type is registered
   */
  has(type: string): boolean

  /**
   * Get all registered custom block definitions
   */
  list(): readonly CustomBlockDefinition[]

  /**
   * Get block definitions by category
   */
  getByCategory(category: BlockCategory): readonly CustomBlockDefinition[]

  /**
   * Get all registered block types
   */
  types(): readonly string[]

  /**
   * Unregister a custom block
   */
  unregister(type: string): boolean

  /**
   * Clear all registrations
   */
  clear(): void

  /**
   * Get a component registry for use with SurfaceRenderer
   */
  getComponents(): BlockComponentRegistry
}

// ============================================================
// VALIDATION TYPES
// ============================================================

/**
 * Block validation result
 */
export interface BlockValidationResult {
  /** Whether the block is valid */
  readonly valid: boolean
  /** The validated block (with defaults applied) */
  readonly block?: Block
  /** Validation errors */
  readonly errors: readonly BlockValidationError[]
}

/**
 * Block validation error
 */
export interface BlockValidationError {
  /** Error code */
  readonly code: string
  /** Error message */
  readonly message: string
  /** Path to the invalid property */
  readonly path?: string
}

/**
 * Props validation result
 */
export interface PropsValidationResult<TProps = Record<string, unknown>> {
  /** Whether the props are valid */
  readonly valid: boolean
  /** The validated props (with defaults applied) */
  readonly props?: TProps
  /** Validation errors */
  readonly errors: readonly BlockValidationError[]
}

// ============================================================
// UTILITY TYPES
// ============================================================

/**
 * Infer props type from a custom block definition
 */
export type InferBlockProps<T> = T extends CustomBlockDefinition<infer TProps> ? TProps : never

/**
 * Infer config type from a factory definition
 */
export type InferFactoryConfig<T> = T extends FactoryDefinition<infer TConfig> ? TConfig : never

/**
 * Infer props type from a Zod schema
 */
export type InferSchemaProps<T> = T extends ZodSchema<infer TOutput> ? TOutput : never
