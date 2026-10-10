/**
 * Dynamic Artifact Context Provider
 *
 * Provides dynamic block and starter descriptor maps
 * to the component tree. Populated from the host's render grants.
 *
 * @module @pwfabric/runtime/render/dynamic-artifact-context
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { DynamicBlockDescriptor, DynamicStarterDescriptor } from '@pwfabric/contracts'
import { BlockModuleLoader } from './dynamic-block-loader.js'

// ============================================================
// TYPES
// ============================================================

export interface DynamicArtifactContextValue {
  readonly dynamicBlocks: ReadonlyMap<string, DynamicBlockDescriptor>
  readonly dynamicStarters: ReadonlyMap<string, DynamicStarterDescriptor>
  readonly isLoaded: boolean
}

export interface DynamicArtifactProviderProps {
  readonly dynamicBlocks?: readonly DynamicBlockDescriptor[]
  readonly dynamicStarters?: readonly DynamicStarterDescriptor[]
  /**
   * Whether the dynamic descriptors have finished loading. Server-rendered
   * consumers (a published page) pass fully-resolved descriptors
   * synchronously and omit this — it defaults to `true`. Client-side editors
   * load descriptors from the host's aggregate after mount, so they pass the
   * live loading state; consumers can then tell "still loading" apart from
   * "genuinely no descriptor" instead of flashing every block as unknown on
   * first paint.
   */
  readonly isLoaded?: boolean
  /**
   * WARM THE WHOLE CATALOG ON MOUNT. Off by default, and that default is the
   * point.
   *
   * This provider typically sits in the host app's root layout, so it is
   * mounted on every route. Preloading from there downloads, hash-verifies and
   * blob-imports every descriptor the host owns on pages that render none of
   * them — dozens of bundles and tens of seconds of summed download on a page
   * with no renderer at all.
   *
   * Rendering a block does not need this: `DynamicBlockWrapper` asks the
   * loader for the descriptor it is about to draw, and the loader caches and
   * de-dupes by block type. Turn it on only where a canvas is genuinely about
   * to render arbitrary blocks and the round trip should already be in flight
   * — a studio or an editor, never a layout.
   */
  readonly preload?: boolean
  readonly children: ReactNode
}

// ============================================================
// CONTEXT
// ============================================================

const DynamicArtifactContext = createContext<DynamicArtifactContextValue>({
  dynamicBlocks: new Map(),
  dynamicStarters: new Map(),
  isLoaded: false,
})

// ============================================================
// PROVIDER
// ============================================================

/**
 * Warm the loader's cache for a whole catalog, fire-and-forget.
 *
 * The imperative half of the same opt-in: a canvas that knows it is about to
 * render arbitrary blocks can start the downloads itself, without the provider
 * having to guess from the fact that it was mounted. Caching and de-duplication
 * stay entirely the loader's business — calling this twice costs one download.
 */
export function preloadDynamicBlocks(
  descriptors: readonly DynamicBlockDescriptor[] | undefined | null
): void {
  if (!descriptors || descriptors.length === 0) return
  BlockModuleLoader.preload(descriptors)
}

/**
 * Provides dynamic block and starter descriptors to the component tree.
 *
 * Downloads nothing by itself: blocks load lazily as they are rendered. Pass
 * `preload` to warm the whole catalog on mount.
 */
export function DynamicArtifactProvider({
  dynamicBlocks,
  dynamicStarters,
  isLoaded = true,
  preload = false,
  children,
}: DynamicArtifactProviderProps): ReactNode {
  const value = useMemo<DynamicArtifactContextValue>(() => {
    const blockMap = new Map<string, DynamicBlockDescriptor>()
    const starterMap = new Map<string, DynamicStarterDescriptor>()

    if (dynamicBlocks) {
      for (const block of dynamicBlocks) {
        blockMap.set(block.blockType, block)
      }
    }

    if (dynamicStarters) {
      for (const starter of dynamicStarters) {
        starterMap.set(starter.starterId, starter)
      }
    }

    return {
      dynamicBlocks: blockMap,
      dynamicStarters: starterMap,
      isLoaded,
    }
  }, [dynamicBlocks, dynamicStarters, isLoaded])

  // In an effect, not in the memo above: a preload is a side effect and a
  // render is not the place for one — inside `useMemo` it also ran during
  // server rendering, where nothing can consume the result.
  useEffect(() => {
    if (!preload) return
    preloadDynamicBlocks(dynamicBlocks)
  }, [preload, dynamicBlocks])

  return <DynamicArtifactContext.Provider value={value}>{children}</DynamicArtifactContext.Provider>
}

// ============================================================
// HOOKS
// ============================================================

/**
 * Access dynamic block descriptors.
 */
export function useDynamicBlocks(): {
  readonly blocks: ReadonlyMap<string, DynamicBlockDescriptor>
  readonly isLoaded: boolean
} {
  const ctx = useContext(DynamicArtifactContext)
  return { blocks: ctx.dynamicBlocks, isLoaded: ctx.isLoaded }
}

/**
 * Access dynamic starter descriptors.
 */
export function useDynamicStarters(): {
  readonly starters: ReadonlyMap<string, DynamicStarterDescriptor>
  readonly isLoaded: boolean
} {
  const ctx = useContext(DynamicArtifactContext)
  return { starters: ctx.dynamicStarters, isLoaded: ctx.isLoaded }
}
