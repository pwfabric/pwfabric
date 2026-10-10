/**
 * Surface Connections React Context
 *
 * Carries the surface's CONNECTIONS CONTEXT — the world's configured
 * connections (name/connector/config, single dialect with the runner's
 * `connections.json` entries) plus the loaded engine registry — through
 * the render tree. Pattern mirrors `EntityFacadeContext`.
 *
 * Consumers:
 * - `DataBoundSurfaceRenderer` routes `{kind:'entity', connector}` data
 *   sources through the registry (via the renderer prop, not this context
 *   — the fetch runs above `SurfaceRenderer`).
 * - Pack blocks on the engine-bridge path read connections/config here
 *   (platform source) instead of the runner's bundled connections.json —
 *   same shape, different source.
 *
 * Absent provider = null = today's behavior (additive, opt-in).
 *
 * @module @pwfabric/runtime/render/connections-context
 */

import { createContext, useContext } from 'react'
import type { SurfaceConnectionsValue } from '../connectors/types.js'

/**
 * React context carrying the connections context. Defaults to null —
 * hosts that don't provide it keep today's behavior everywhere.
 */
export const SurfaceConnectionsContext = createContext<SurfaceConnectionsValue | null>(null)

/**
 * Returns the connections context from the nearest provider, or null when
 * the host didn't opt in (runner default path, legacy platform rendering).
 */
export function useSurfaceConnections(): SurfaceConnectionsValue | null {
  return useContext(SurfaceConnectionsContext)
}
