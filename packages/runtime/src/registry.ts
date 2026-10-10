/**
 * Capability Registry
 *
 * Registry for managing capability registration and lookup
 *
 * @module @pwfabric/runtime/registry
 */

import type {
  CapabilityId,
  Capability,
  RegistrationResult,
  RegistrationError,
  Resolution,
  ResolutionFailure,
} from '@pwfabric/contracts'

// ============================================================
// REGISTRY INTERFACE
// ============================================================

/**
 * Capability registry for managing registered capabilities
 */
export interface CapabilityRegistry {
  /**
   * Register a capability
   */
  register<C extends Capability>(capability: C): RegistrationResult<C>

  /**
   * Unregister a capability
   */
  unregister(id: CapabilityId): boolean

  /**
   * Resolve a capability by ID
   */
  resolve<C extends Capability>(id: CapabilityId): Resolution<C>

  /**
   * Check if a capability is registered
   */
  has(id: CapabilityId): boolean

  /**
   * Get all registered capability IDs
   */
  list(): readonly CapabilityId[]

  /**
   * Get the count of registered capabilities
   */
  size(): number

  /**
   * Clear all registered capabilities
   */
  clear(): void
}

// ============================================================
// IN-MEMORY REGISTRY IMPLEMENTATION
// ============================================================

/**
 * In-memory capability registry
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly capabilities = new Map<CapabilityId, Capability>()
  private readonly dependencyGraph = new Map<CapabilityId, Set<CapabilityId>>()

  register<C extends Capability>(capability: C): RegistrationResult<C> {
    const { id, dependencies } = capability

    // Check if already registered
    if (this.capabilities.has(id)) {
      const error: RegistrationError = {
        type: 'already_registered',
        id,
      }
      return { success: false, error }
    }

    // Validate dependencies exist
    for (const depId of dependencies) {
      if (!this.capabilities.has(depId)) {
        const error: RegistrationError = {
          type: 'missing_dependency',
          id,
          missing: depId,
        }
        return { success: false, error }
      }
    }

    // Check for circular dependencies
    const cycle = this.detectCircularDependency(id, dependencies)
    if (cycle) {
      const error: RegistrationError = {
        type: 'circular_dependency',
        cycle,
      }
      return { success: false, error }
    }

    // Register the capability
    this.capabilities.set(id, capability)
    this.dependencyGraph.set(id, new Set(dependencies))

    return { success: true, capability }
  }

  unregister(id: CapabilityId): boolean {
    if (!this.capabilities.has(id)) {
      return false
    }

    // Check if other capabilities depend on this one
    for (const [, deps] of this.dependencyGraph) {
      if (deps.has(id)) {
        // Cannot unregister - something depends on it
        return false
      }
    }

    this.capabilities.delete(id)
    this.dependencyGraph.delete(id)
    return true
  }

  resolve<C extends Capability>(id: CapabilityId): Resolution<C> {
    const capability = this.capabilities.get(id)

    if (!capability) {
      const reason: ResolutionFailure = {
        type: 'not_found',
        id,
      }
      return { found: false, reason }
    }

    return { found: true, capability: capability as C }
  }

  has(id: CapabilityId): boolean {
    return this.capabilities.has(id)
  }

  list(): readonly CapabilityId[] {
    return Array.from(this.capabilities.keys())
  }

  size(): number {
    return this.capabilities.size
  }

  clear(): void {
    this.capabilities.clear()
    this.dependencyGraph.clear()
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependency(
    newId: CapabilityId,
    newDeps: readonly CapabilityId[]
  ): readonly CapabilityId[] | null {
    const visited = new Set<CapabilityId>()
    const path: CapabilityId[] = []

    const dfs = (id: CapabilityId): readonly CapabilityId[] | null => {
      if (path.includes(id)) {
        // Found a cycle
        const cycleStart = path.indexOf(id)
        return [...path.slice(cycleStart), id]
      }

      if (visited.has(id)) {
        return null
      }

      visited.add(id)
      path.push(id)

      const deps = id === newId ? newDeps : Array.from(this.dependencyGraph.get(id) || [])
      for (const depId of deps) {
        const cycle = dfs(depId)
        if (cycle) return cycle
      }

      path.pop()
      return null
    }

    return dfs(newId)
  }
}

/**
 * Create a new capability registry
 */
export function createRegistry(): CapabilityRegistry {
  return new InMemoryCapabilityRegistry()
}
