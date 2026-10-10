/**
 * Identity and Addressing Primitives
 *
 * PHASE0-WS1: Core identity types for PWFabric
 *
 * These types use branded types (opaque types) to provide
 * compile-time safety for different ID types that are
 * structurally identical (all strings) but semantically distinct.
 *
 * @module @pwfabric/contracts/core/ids
 */

/**
 * Brand symbol for nominal typing
 */
declare const brand: unique symbol

/**
 * Branded type helper - creates nominally typed strings
 */
type Brand<T, B extends string> = T & { readonly [brand]: B }

// ============================================================
// FABRIC IDENTITY TYPES
// ============================================================

/**
 * Unique identifier for a Fabric instance
 */
export type FabricId = Brand<string, 'FabricId'>

/**
 * Unique identifier for a Capability
 */
export type CapabilityId = Brand<string, 'CapabilityId'>

/**
 * Unique identifier for a Contract
 */
export type ContractId = Brand<string, 'ContractId'>

/**
 * Unique identifier for a Surface
 */
export type SurfaceId = Brand<string, 'SurfaceId'>

/**
 * Unique identifier for a Manifestation
 */
export type ManifestationId = Brand<string, 'ManifestationId'>

/**
 * Unique identifier for a Domain
 */
export type DomainId = Brand<string, 'DomainId'>

/**
 * Unique identifier for an Owner (human or system)
 */
export type OwnerId = Brand<string, 'OwnerId'>

/**
 * Unique identifier for an Artifact
 */
export type ArtifactId = Brand<string, 'ArtifactId'>

// ============================================================
// WORLD LAYER IDENTITY
// ============================================================

/**
 * User identifier — auth principal. A single user may belong to many Worlds.
 */
export type UserId = Brand<string, 'UserId'>

/**
 * ISO 8601 datetime string. Branded for documentation; runtime is plain string.
 * Always UTC; suffix `Z` required.
 */
export type ISODateTime = Brand<string, 'ISODateTime'>

// ============================================================
// ID CONSTRUCTORS
// ============================================================

/**
 * Create a FabricId from a string
 * Runtime validation should be performed by the caller
 */
export function fabricId(id: string): FabricId {
  return id as FabricId
}

/**
 * Create a CapabilityId from a string
 */
export function capabilityId(id: string): CapabilityId {
  return id as CapabilityId
}

/**
 * Create a ContractId from a string
 */
export function contractId(id: string): ContractId {
  return id as ContractId
}

/**
 * Create a SurfaceId from a string
 */
export function surfaceId(id: string): SurfaceId {
  return id as SurfaceId
}

/**
 * Create a ManifestationId from a string
 */
export function manifestationId(id: string): ManifestationId {
  return id as ManifestationId
}

/**
 * Create a DomainId from a string
 */
export function domainId(id: string): DomainId {
  return id as DomainId
}

/**
 * Create an OwnerId from a string
 */
export function ownerId(id: string): OwnerId {
  return id as OwnerId
}

/**
 * Create an ArtifactId from a string
 */
export function artifactId(id: string): ArtifactId {
  return id as ArtifactId
}

// ============================================================
// WORLD LAYER ID CONSTRUCTORS
// ============================================================

export function userId(id: string): UserId {
  return id as UserId
}

export function isoDateTime(s: string): ISODateTime {
  return s as ISODateTime
}

// ============================================================
// ID VALIDATION
// ============================================================

/**
 * ID format: namespace/name or namespace/name@version
 * Examples:
 *   - "auth/login"
 *   - "payments/process@1.0.0"
 *   - "core/validate"
 */
export const ID_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*(@\d+\.\d+\.\d+(-[a-z0-9.]+)?)?$/i

/**
 * Check if a string is a valid PWFabric ID format
 */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}

/**
 * Parse an ID into namespace and name parts
 */
export function parseId(id: string): { namespace: string; name: string; version?: string } | null {
  const match = id.match(/^([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)(?:@(.+))?$/i)
  if (!match || !match[1] || !match[2]) return null

  const result: { namespace: string; name: string; version?: string } = {
    namespace: match[1],
    name: match[2],
  }

  if (match[3]) {
    result.version = match[3]
  }

  return result
}
