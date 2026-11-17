/**
 * Block Component Types
 *
 * Minimal type definitions for block React components.
 * These types are structurally compatible with @pwfabric/runtime's
 * BlockComponent and BlockComponentRegistry types.
 *
 * @module @pwfabric/runtime/blocks/component-types
 */

import type { ReactNode } from 'react'
import type { Block } from '@pwfabric/contracts'
import type { BreakpointName } from '@pwfabric/core'

// ============================================================
// SURFACE EVENTS (minimal subset used by block components)
// ============================================================

/**
 * Surface event types emitted by block components
 */
export type BlockSurfaceEventType = 'click' | 'submit' | 'change' | 'navigate' | 'custom'

/**
 * Surface event emitted by block components
 */
export interface BlockSurfaceEvent {
  /** Event type */
  readonly type: BlockSurfaceEventType
  /** Block ID that triggered the event */
  readonly blockId: string
  /** Event payload */
  readonly payload?: unknown
  /** Original DOM event (if applicable) */
  readonly originalEvent?: Event
}

// ============================================================
// BLOCK CONTEXT (minimal subset needed by block components)
// ============================================================

/**
 * Minimal block rendering context available to block components.
 * Structurally compatible with @pwfabric/runtime's BlockContext.
 */
export interface BlockComponentContext {
  /** Event handler for block events */
  readonly onEvent?: ((event: BlockSurfaceEvent) => void) | undefined
  /** Current viewport breakpoint */
  readonly viewport?: BreakpointName
  /** Image adapter (optional, runtime-provided) */
  readonly imageAdapter?: unknown
  /** Capabilities (optional, runtime-provided) */
  readonly capabilities?: Map<string, unknown>
}

// ============================================================
// BLOCK COMPONENT TYPES
// ============================================================

/**
 * Props passed to block components
 */
export interface BlockComponentProps<T = Record<string, unknown>> {
  /** Block instance */
  readonly block: Block
  /** Resolved props (validated and defaulted) */
  readonly props: T
  /** Rendered children (for container blocks) */
  readonly children?: ReactNode
  /** Block context */
  readonly context: BlockComponentContext
}

/**
 * Block component type
 */
export type BlockComponent<T = Record<string, unknown>> = ((
  props: BlockComponentProps<T>
) => ReactNode) & {
  /**
   * How the block wants to be sized when it sits in a flex ROW.
   *
   * The engine's default for a row child is an equal share (`flex: 1 1 0`) —
   * right for two content columns, wrong for an avatar, a badge, a button: an
   * intrinsic thing stretched to half a row is the single most measured layout
   * defect of the 2026-09 surface audit (127 hand-written `flex: 0 0 auto`
   * overrides across 14 receipts). A block whose natural width is its content
   * declares `sizing: 'intrinsic'` — as a static on the component, the same
   * way `displayName` travels — and the engine gives it `flex: 0 0 auto`.
   * An authored flex hint on the instance still wins. The engine memorises no
   * block names: the block declares, the engine obeys.
   */
  sizing?: BlockSizing
}

/**
 * The sizing words the engine knows besides its default (a fluid share).
 *
 * - `intrinsic` — the block's width is its content (avatar, badge, button):
 *   in a row it keeps that width instead of taking an equal share.
 * - `fill` — the block takes the whole width of where it is placed and has no
 *   content width of its own (a progress bar, a rule). Its wrapper fills the
 *   parent's line in a column or centred parent, so the block does not
 *   collapse to the zero width of a wrapper shrunk around nothing. In a row the
 *   flex share decides, as for any fluid block.
 */
export type BlockSizing = 'intrinsic' | 'fill'

/**
 * Block component registry — maps block type strings to React component implementations
 */
export type BlockComponentRegistry = Record<string, BlockComponent>
