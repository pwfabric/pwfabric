/**
 * Surface Event Context
 *
 * React context that carries the SurfaceEventBus down the render tree
 * so block components can emit events without prop-drilling.
 *
 * The default value is `null`; block components that call `useSurfaceEvents()`
 * when no bus is provided simply no-op rather than throwing.
 *
 * @module @pwfabric/runtime/blocks/surface-event-context
 */

import { createContext } from 'react'
import type { SurfaceEventBus } from '@pwfabric/contracts'

export const SurfaceEventContext = createContext<SurfaceEventBus | null>(null)
