/**
 * Entity Facade React Context
 *
 * Provides EntityFacade to the surface render tree via React
 * context. Pattern mirrors SurfaceRoutingContext / useSurfaceRouting().
 *
 * Injection point: EntityFacadeContext.Provider wraps BehaviorSurfaceProvider
 * inside SurfaceRenderer when entityFacade prop is supplied.
 *
 * @module @pwfabric/runtime/render/entity-facade-context
 */

import { createContext, useContext } from 'react'
import type { EntityFacade } from '../entity/facade.js'

/**
 * React context that carries an EntityFacade instance through the render tree.
 * Defaults to null — blocks that require entity access check for null and
 * gracefully handle the absent-facade case.
 */
export const EntityFacadeContext = createContext<EntityFacade | null>(null)

/**
 * Returns the EntityFacade from the nearest EntityFacadeContext.Provider.
 * Returns null when no provider is present (entity support not configured).
 *
 * @example
 * ```tsx
 * import { useEntityFacade } from '@pwfabric/runtime/render'
 *
 * function MyBlock() {
 *   const facade = useEntityFacade()
 *   if (!facade) return null  // No entity support configured
 *   const result = await facade.store.query('Employee', {})
 * }
 * ```
 */
export function useEntityFacade(): EntityFacade | null {
  return useContext(EntityFacadeContext)
}
