/**
 * Surface Mutation Types
 *
 * Surface Atomic Mutation Endpoint.
 *
 * Defines the typed mutation operations that can be applied to a SurfaceDocument
 * via the POST /api/surfaces/:id/mutations endpoint. Each mutation is a discrete,
 * named operation on a specific part of the surface definition.
 *
 * @module @pwfabric/contracts/fabric/surface-mutation
 */

import type { ResponsiveValue } from './layout.js'

/**
 * A `block.style` value map: each CSS property is a flat string OR a
 * per-breakpoint `ResponsiveValue<string>` (mirrors `Block.style`). Mutations
 * must carry the same shape blocks can, so responsive style survives the edit.
 */
type MutationStyle = Record<string, string | ResponsiveValue<string>>

// ============================================================
// MUTATION OPERATIONS
// ============================================================

/**
 * Add a new block to the surface.
 *
 * `id` — client-generated UUID for the new block (must be unique within the surface).
 * `parentId` — ID of the parent block whose children array this block is added to.
 *              Omit (or use `'root'`) to add at the top level.
 * `index` — insertion position within the children array. Appends if omitted.
 */
export interface AddBlockMutation {
  readonly op: 'add-block'
  readonly id: string
  readonly type: string
  readonly parentId?: string
  readonly index?: number
  readonly props?: Record<string, unknown>
  readonly layout?: Record<string, unknown>
  readonly style?: MutationStyle
}

/**
 * Remove a block and all its descendants from the surface.
 */
export interface RemoveBlockMutation {
  readonly op: 'remove-block'
  readonly blockId: string
}

/**
 * Move a block to a new parent at a given index.
 *
 * `newParentId` — ID of the new parent block. Omit (or use `'root'`) to move to top level.
 */
export interface MoveBlockMutation {
  readonly op: 'move-block'
  readonly blockId: string
  readonly newParentId?: string
  readonly index: number
}

/**
 * Shallow-merge props onto an existing block.
 * Top-level keys in `props` overwrite existing values; omitted keys are unchanged.
 */
export interface UpdatePropsMutation {
  readonly op: 'update-props'
  readonly blockId: string
  readonly props: Record<string, unknown>
}

/**
 * Shallow-merge CSS property overrides onto block.style (Layer 4 — block-level CSS).
 * Keys in `style` overwrite existing values; omitted keys are unchanged.
 * Values must be valid CSS property values (strings).
 */
export interface UpdateStyleMutation {
  readonly op: 'update-style'
  readonly blockId: string
  readonly style: MutationStyle
}

/**
 * Add a surface-level CSS custom property override (styleVariables).
 * Key must be WITHOUT the '--' prefix (e.g. `'color-primary'`).
 */
export interface AddVarMutation {
  readonly op: 'add-var'
  readonly key: string
  readonly value: string
}

/** Update an existing styleVariable value. */
export interface UpdateVarMutation {
  readonly op: 'update-var'
  readonly key: string
  readonly value: string
}

/** Remove a styleVariable entry by key. */
export interface RemoveVarMutation {
  readonly op: 'remove-var'
  readonly key: string
}

/**
 * Add or overwrite a single theme token within a theme section.
 * `section` — one of 'colors' | 'border' | 'typography' | 'spacing' | 'shadows' | 'motion'
 * `key` — the token name (e.g. 'primary', 'radius', 'fontFamily', 'base')
 */
export interface AddTokenMutation {
  readonly op: 'add-token'
  readonly section: 'colors' | 'border' | 'typography' | 'spacing' | 'shadows' | 'motion'
  readonly key: string
  readonly value: string
}

/** Update an existing theme token value. */
export interface UpdateTokenMutation {
  readonly op: 'update-token'
  readonly section: 'colors' | 'border' | 'typography' | 'spacing' | 'shadows' | 'motion'
  readonly key: string
  readonly value: string
}

/** Remove a theme token by section and key. */
export interface RemoveTokenMutation {
  readonly op: 'remove-token'
  readonly section: 'colors' | 'border' | 'typography' | 'spacing' | 'shadows' | 'motion'
  readonly key: string
}

/**
 * Add a platform capability requirement to the surface.
 */
export interface AddCapabilityMutation {
  readonly op: 'add-capability'
  readonly capability: string
  readonly required?: boolean
  readonly config?: Record<string, unknown>
}

/** Remove a capability requirement by its identifier. */
export interface RemoveCapabilityMutation {
  readonly op: 'remove-capability'
  readonly capability: string
}

/** Add a new data source to the surface. Idempotent — skips if id already exists. */
export interface AddDataSourceMutation {
  readonly op: 'add-data-source'
  readonly id: string
  readonly kind: 'rest' | 'static' | 'state' | 'entity'
  readonly endpoint?: string
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly staticData?: unknown
  readonly refreshInterval?: number
  /** `kind:'entity'` — the entity type to list via the platform/entities facade. */
  readonly entityType?: string
  /** `kind:'entity'` — optional filter/sort/pagination passed to the facade. */
  readonly query?: Record<string, unknown>
  /**
   * which data-plane engine serves this source (e.g.
   * 'graph-lists'); absent = platform default facade.
   */
  readonly connector?: string
  /**
   * reference to the world connection/auth binding BY NAME;
   * never carries credential values (auth law).
   */
  readonly authProviderRef?: string
}

/** Remove a data source by its identifier. */
export interface RemoveDataSourceMutation {
  readonly op: 'remove-data-source'
  readonly sourceId: string
}

/** Shallow-merge updates onto an existing data source. */
export interface UpdateDataSourceMutation {
  readonly op: 'update-data-source'
  readonly sourceId: string
  readonly endpoint?: string
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly staticData?: unknown
  readonly refreshInterval?: number
  /** `kind:'entity'` — the entity type to list via the platform/entities facade. */
  readonly entityType?: string
  /** `kind:'entity'` — optional filter/sort/pagination passed to the facade. */
  readonly query?: Record<string, unknown>
  /**
   * which data-plane engine serves this source (e.g.
   * 'graph-lists'); absent = platform default facade.
   */
  readonly connector?: string
  /**
   * reference to the world connection/auth binding BY NAME;
   * never carries credential values (auth law).
   */
  readonly authProviderRef?: string
}

// ============================================================
// NEW OPS — Unified Mutation Pipeline
// ============================================================

/**
 * Update surface metadata (name, description, tags, thumbnailUrl).
 * Only provided fields are updated; omitted fields are unchanged.
 */
export interface UpdateMetaMutation {
  readonly op: 'update-meta'
  readonly name?: string
  readonly description?: string
  readonly tags?: string[]
  readonly thumbnailUrl?: string
}

/**
 * Update responsive layout for a specific block (span, offset, order, hidden per breakpoint).
 * Shallow-merges the layout object onto the block's existing layout.
 */
export interface UpdateBlockLayoutMutation {
  readonly op: 'update-block-layout'
  readonly blockId: string
  readonly layout: Record<string, unknown>
}

/**
 * Update global surface layout config (columns, gap, padding, maxWidth).
 * Shallow-merges onto the existing layout config.
 */
export interface UpdateSurfaceLayoutMutation {
  readonly op: 'update-surface-layout'
  readonly layout: Record<string, unknown>
}

/**
 * Update capability required flag and/or config.
 * The capability must already exist on the surface.
 */
export interface UpdateCapabilityConfigMutation {
  readonly op: 'update-capability-config'
  readonly capability: string
  readonly required?: boolean
  readonly config?: Record<string, unknown>
}

/**
 * Set the surface's initial state (replaces entirely).
 */
export interface SetInitialStateMutation {
  readonly op: 'set-initial-state'
  readonly state: Record<string, unknown>
}

/**
 * Clear all CSS style overrides from a block (reset block.style to empty).
 */
export interface ClearStyleMutation {
  readonly op: 'clear-style'
  readonly blockId: string
}

/**
 * Bulk-merge a partial theme onto the surface theme.
 * Merges at the section level (colors, border, typography, spacing, shadows, motion).
 */
export interface SetThemeMutation {
  readonly op: 'set-theme'
  readonly theme: Record<string, unknown>
}

/** Reset the surface theme to defaults (removes all theme tokens). */
export interface ResetThemeMutation {
  readonly op: 'reset-theme'
}

// ============================================================
// UNION TYPE
// ============================================================

/**
 * All supported surface mutation operations.
 */
export type SurfaceMutation =
  | AddBlockMutation
  | RemoveBlockMutation
  | MoveBlockMutation
  | UpdatePropsMutation
  | UpdateStyleMutation
  | AddVarMutation
  | UpdateVarMutation
  | RemoveVarMutation
  | AddTokenMutation
  | UpdateTokenMutation
  | RemoveTokenMutation
  | AddCapabilityMutation
  | RemoveCapabilityMutation
  | AddDataSourceMutation
  | RemoveDataSourceMutation
  | UpdateDataSourceMutation
  // Unified Mutation Pipeline
  | UpdateMetaMutation
  | UpdateBlockLayoutMutation
  | UpdateSurfaceLayoutMutation
  | UpdateCapabilityConfigMutation
  | SetInitialStateMutation
  | ClearStyleMutation
  | SetThemeMutation
  | ResetThemeMutation

// ============================================================
// REQUEST / RESPONSE TYPES
// ============================================================

/**
 * Request body for POST /api/surfaces/:id/mutations
 */
export interface MutationRequest {
  readonly mutations: readonly SurfaceMutation[]
}

/**
 * Response body for a successful mutation batch.
 */
export interface MutationResponse {
  /** Updated surface definition after all mutations were applied */
  readonly definition: Record<string, unknown>
  /** Number of mutations successfully applied */
  readonly appliedCount: number
  /** ISO timestamp of the save */
  readonly updatedAt: string
}
