/**
 * @pwfabric/contracts
 *
 * The public contract surface for PWFabric — the integrator and pack author
 * developer surface, and the foundation of the type system.
 *
 * IMMUTABILITY NOTICE: Once released, contracts in this package are FROZEN.
 * Any modifications require a new version.
 *
 * @module @pwfabric/contracts
 */

// Core primitives (ids, versioning, results, schemas)
export * from './core/index.js'

// Fabric types (fabric, capability, contract, surface, manifestation, domain)
export * from './fabric/index.js'

// Capability authoring (fluent builder: CapabilityBuilder, defineCapability)
export * from './capability/index.js'
