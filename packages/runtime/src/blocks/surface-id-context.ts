/**
 * Surface ID Context
 *
 * React context that carries the current surface ID down the render tree
 * so block components can include it in emitted events without prop-drilling.
 *
 * The default value is an empty string; blocks that read this context when
 * no `BehaviorSurfaceProvider` is present will emit events with an empty
 * surfaceId rather than throwing.
 *
 * @module @pwfabric/runtime/blocks/surface-id-context
 */

import { createContext } from 'react'

export const SurfaceIdContext = createContext<string>('')
