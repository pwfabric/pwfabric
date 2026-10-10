/**
 * Block Component Hooks
 *
 * React hooks used by block components for event emission and surface ID access.
 *
 * @module @pwfabric/runtime/blocks/hooks
 */

import { useContext } from 'react'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'
import { SurfaceEventContext } from './surface-event-context.js'
import { SurfaceIdContext } from './surface-id-context.js'

/**
 * Hook for block components to emit surface events.
 *
 * When the context is absent (no bus provided by the surface renderer)
 * the hook returns a no-op `emit` so callers need no guard code.
 *
 * @example
 * ```tsx
 * const { emit } = useSurfaceEvents()
 *
 * const handleClick = () => {
 *   emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id })
 * }
 * ```
 */
export function useSurfaceEvents(): {
  emit: (partial: Omit<SurfaceEventDescriptor, 'timestamp'>) => void
} {
  const bus = useContext(SurfaceEventContext)

  const emit = (partial: Omit<SurfaceEventDescriptor, 'timestamp'>): void => {
    if (!bus) return
    bus.emit({ ...partial, timestamp: Date.now() })
  }

  return { emit }
}

/**
 * Hook that returns the current surface ID from `SurfaceIdContext`.
 * Returns an empty string when no `BehaviorSurfaceProvider` is in the tree.
 */
export function useSurfaceId(): string {
  return useContext(SurfaceIdContext)
}
