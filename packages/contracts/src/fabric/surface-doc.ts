/**
 * SurfaceDocument Canonical Type
 *
 * SurfaceDocument Canonical Type System.
 *
 * A SurfaceDocument is the complete, serialisable representation of a PWFabric surface.
 * It is the single source of truth shared across editor, renderer, and API persistence.
 *
 * @module @pwfabric/contracts/fabric/surface-doc
 */

import type { Block } from './block.js'
import type { SurfaceAppearanceRef } from './surface-appearance.js'

// ============================================================
// DATA SOURCE
// ============================================================

/**
 * JSON-serialisable data source definition within a surface.
 *
 * Kinds:
 * - `rest`    — fetches from an HTTP endpoint
 * - `static`  — inline JSON data embedded in the surface
 * - `state`   — reads from surface runtime state
 *
 * Note: 'computed' is excluded because functions cannot be serialised in JSON.
 */
export interface SurfaceDataSource {
  /** Unique source identifier — used as the key in expression context */
  readonly id: string

  /** Source kind */
  readonly kind: 'rest' | 'static' | 'state' | 'entity'

  /** REST endpoint (may contain {{state.key}} placeholders) */
  readonly endpoint?: string

  /** HTTP method for REST sources */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'

  /** Static inline data */
  readonly staticData?: unknown

  /** Auto-refresh interval in milliseconds (0 or undefined = no auto-refresh) */
  readonly refreshInterval?: number

  /** Entity type to list (kind: 'entity') via the platform/entities facade. */
  readonly entityType?: string

  /** Optional query for entity sources (filter/sort/pagination). */
  readonly query?: Record<string, unknown>

  /**
   * Which data-plane engine serves this source (e.g. 'graph-lists').
   * Absent = platform default facade. (dialect unification
   * the runner already read this field; the contract now declares it).
   */
  readonly connector?: string

  /**
   * Reference to the world connection/auth binding BY NAME; never
   * carries credential values (auth law).
   */
  readonly authProviderRef?: string
}

// ============================================================
// CAPABILITY REQUIREMENT
// ============================================================

/**
 * Declares a platform capability required by the surface.
 *
 * At render time the host verifies each required capability is available
 * and configured before rendering the surface.
 */
export interface SurfaceCapabilityRequirement {
  /** Capability identifier (e.g. 'platform/persistence', 'platform/navigation') */
  readonly capability: string

  /** Whether the capability is required (true) or optional (false) */
  readonly required: boolean

  /** Capability-specific configuration */
  readonly config?: Record<string, unknown>
}

// ============================================================
// SURFACE DOCUMENT
// ============================================================

/**
 * SurfaceDocument — the canonical PWFabric surface representation.
 *
 * This interface is the single source of truth for:
 * - Editor state
 * - Runtime rendering (@pwfabric/runtime — RenderableSurface is a Pick of this)
 * - API persistence (surfaceDocumentSchema validates this)
 *
 * All fields are optional except `id`, `name`, and `blocks` to support
 * partial documents in the composer and incremental population during creation.
 */
export interface SurfaceDocument {
  /** Unique surface identifier */
  readonly id: string

  /** Human-readable surface name */
  readonly name: string

  /** Optional description for discoverability */
  readonly description?: string

  /** Searchable tags */
  readonly tags?: readonly string[]

  /** Thumbnail image URL for surface previews */
  readonly thumbnailUrl?: string

  /** Block composition — the visual content tree */
  readonly blocks: readonly Block[]

  /**
   * UI appearance atom reference.
   *
   * Replaces the former `theme`, `styleVariables`, and layout root
   * fields. Points to a `ui-appearance` atom installed for the app;
   * the atom bundle's `apply()` method converts the
   * accompanying config into CSS custom properties on the surface root.
   *
   * Absent → renderer falls back to the platform-default appearance
   * atom (`appearance-default`).
   */
  readonly appearance?: SurfaceAppearanceRef

  /**
   * Platform capabilities required or used by this surface.
   *
   * the former `dataSources` and `initialState` root fields
   * now live inside the `platform/persistence` capability binding's
   * config.
   */
  readonly capabilities?: readonly SurfaceCapabilityRequirement[]
}
