/**
 * Data Capability Provider
 *
 * React context bridge between the capability registry and the render layer.
 * Instantiates a DataService with config and exposes it via useDataService() hook.
 *
 * This is the canonical pattern for capability → React integration.
 * Other capabilities (auth, routing, analytics, etc.) should follow the same structure.
 *
 * @module @pwfabric/runtime/data/DataCapabilityProvider
 */

import * as React from 'react'
import { DataService } from './manager.js'
import type { DataServiceInterface, DataServiceConfig } from './types.js'

// ============================================================
// CONTEXT
// ============================================================

const DataServiceContext = React.createContext<DataServiceInterface | null>(null)

// ============================================================
// PROVIDER
// ============================================================

export interface DataCapabilityProviderProps {
  readonly config?: DataServiceConfig
  readonly service?: DataServiceInterface
  readonly children: React.ReactNode
}

/**
 * Provides a DataService instance to the component tree.
 *
 * Usage:
 * - Pass `config` to let the provider create a DataService internally.
 * - Pass `service` to inject an existing DataService (useful for testing or
 *   when the capability registry has already instantiated one).
 * - If both are provided, `service` takes precedence.
 */
export function DataCapabilityProvider({
  config,
  service,
  children,
}: DataCapabilityProviderProps): React.ReactElement {
  const dataService = React.useMemo(() => {
    if (service) return service
    return new DataService(config)
  }, [service, config])

  return <DataServiceContext.Provider value={dataService}>{children}</DataServiceContext.Provider>
}

// ============================================================
// HOOK
// ============================================================

/**
 * Access the DataService from the nearest DataCapabilityProvider.
 *
 * @throws Error if called outside of a DataCapabilityProvider.
 */
export function useDataService(): DataServiceInterface {
  const service = React.useContext(DataServiceContext)
  if (!service) {
    throw new Error('useDataService must be used within a DataCapabilityProvider')
  }
  return service
}

/**
 * Optionally access the DataService — returns null if no provider is present.
 * Useful for components that work with or without data binding.
 */
export function useOptionalDataService(): DataServiceInterface | null {
  return React.useContext(DataServiceContext)
}
