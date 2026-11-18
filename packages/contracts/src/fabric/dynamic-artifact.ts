/**
 * Dynamic Artifact Contract Types
 *
 * Runtime Dynamic Artifact Loading
 *
 * Types for dynamically loaded blocks (ESM import), starters (JSON seeding),
 * and bundles (cascade install) at runtime.
 *
 * @module @pwfabric/contracts/fabric/dynamic-artifact
 */

import type { BlockPropDescriptor } from './block-prop.js'

// ============================================================
// BLOCK ARTIFACT TYPES (Code Loading)
// ============================================================

/**
 * Metadata stored in listing.metadata.artifact after server-side esbuild.
 */
export interface BlockArtifactMetadata {
  readonly bundlePath: string
  readonly integrity: string // SHA-256 hash
  readonly bundleSize: number
  readonly exports: readonly string[]
  readonly externals: readonly string[]
  readonly builtAt: number
}

/**
 * Property schema entry for editor integration.
 */
export interface PropertySchemaEntry {
  readonly name: string
  readonly type: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'json'
  readonly label: string
  readonly defaultValue?: unknown
  readonly options?: readonly string[]
  readonly description?: string
}

/**
 * One prop a block's manifest declares (block-manifest, "Prop descriptor"),
 * as the host hands it to the renderer in `blocks/manifest.json`: its name,
 * whether it takes a binding, its default and its shape. The renderer applies
 * the default and the shape before the block renders (`applyBlockProps`) and
 * leaves a `bindable: false` prop as written.
 */
export type DynamicBlockProp = BlockPropDescriptor

/**
 * Block definition extracted from the dynamic module.
 */
export interface DynamicBlockDefinition {
  readonly name: string
  /** The props the block's manifest declares (`definition.props`): the only definition of what the block takes. */
  readonly props?: readonly DynamicBlockProp[]
  readonly icon?: string
  readonly category?: string
  readonly defaultProps?: Readonly<Record<string, unknown>>
  readonly canHaveChildren?: boolean
  readonly propertySchema?: readonly PropertySchemaEntry[]
}

/**
 * Client-side descriptor for a dynamically loaded block.
 * Sent by the host that serves the app, alongside the atoms it may use.
 */
export interface DynamicBlockDescriptor {
  readonly blockType: string
  readonly moduleUrl: string
  readonly integrity: string
  readonly publisher: string
  readonly publisherVerified: boolean
  readonly definition: DynamicBlockDefinition
}

// ============================================================
// STARTER ARTIFACT TYPES (Data Seeding)
// ============================================================

/**
 * Metadata stored in listing.metadata.artifact for starters.
 * Starters are pure data — no executable code.
 */
export interface StarterArtifactMetadata {
  readonly starterSurface: unknown // Serialized block tree JSON
  readonly blockTypes: readonly string[]
  readonly blockCount: number
  readonly previewImage?: string
}

/**
 * Client-side descriptor for a dynamically registered starter.
 * Sent by the host that serves the app, alongside the atoms it may use.
 */
export interface DynamicStarterDescriptor {
  readonly starterId: string
  readonly name: string
  readonly description: string
  readonly category?: string
  readonly tags?: readonly string[]
  readonly blocks: unknown // Serialized Block[] tree
  readonly previewImage?: string
  readonly publisher: string
  readonly publisherVerified: boolean
  readonly requiredBlockTypes: readonly string[]
}

// ============================================================
// BUNDLE CASCADE TYPES
// ============================================================

/**
 * Result of a bundle cascade install operation.
 */
export interface BundleCascadeResult {
  readonly installed: readonly {
    readonly listingId: string
    readonly artifactType: string
    readonly name: string
  }[]
  readonly skipped: readonly {
    readonly listingId: string
    readonly reason: string
  }[]
  readonly failed: readonly {
    readonly listingId: string
    readonly error: string
  }[]
}
