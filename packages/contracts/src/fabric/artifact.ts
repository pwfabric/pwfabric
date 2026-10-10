/**
 * Artifact Contract Types
 *
 * Artifact Packaging & Upload System
 *
 * Types for package manifests, artifact descriptors, validation,
 * and publisher extensions.
 *
 * @module @pwfabric/contracts/fabric/artifact
 */

import type { SemanticVersion } from '../core/version.js'
import type { PwpackManifest } from './atom.js'

// ============================================================
// ARTIFACT KIND
// ============================================================

/**
 * What KIND of thing an artifact is — a property of the artifact itself, not
 * of any place that sells it.
 *
 * The marketplace is a consumer of the kind, not its owner, so the union is
 * declared here and `marketplace.ts` imports it — an engine module never
 * imports from a platform module.
 *
 * - `block` — L1 primitive block
 * - `starter` — L2 starter surface
 * - `capability` — L3 capability
 * - `bundle` — curated collection
 * - `pwfpack` — a package as a whole
 */
export type ArtifactType = 'pwfpack' | 'starter' | 'block' | 'capability' | 'bundle'

// ============================================================
// PACKAGE REQUIREMENTS
// ============================================================
//
// The deployment unit is the atoms[] pwpack (`PwpackManifest` / `AtomRef` in
// ./atom.ts), packaged, published and bundled per atom.

/**
 * What a package requires (dependencies)
 */
export interface ArtifactRequires {
  readonly blocks?: readonly string[]
  readonly capabilities?: readonly string[]
}

// ============================================================
// ARTIFACT DESCRIPTOR
// ============================================================

/**
 * Artifact scope (where the artifact is accessible)
 */
export type ArtifactScope = 'workspace' | 'marketplace'

/**
 * Artifact processing status
 */
export type ArtifactStatus = 'uploading' | 'validating' | 'valid' | 'invalid' | 'published'

/**
 * Artifact database record representation
 */
export interface ArtifactDescriptor {
  readonly id: string
  readonly scope: ArtifactScope
  readonly worldId: string
  readonly publisherId?: string
  readonly listingId?: string
  readonly name: string
  readonly version: SemanticVersion
  readonly artifactType: ArtifactType
  readonly manifest: PwpackManifest
  readonly storageKey: string
  readonly fileSize: number
  readonly checksum: string
  readonly status: ArtifactStatus
  readonly validationErrors?: readonly ManifestValidationIssue[]
  readonly createdAt: number
  readonly updatedAt: number
}

// ============================================================
// VALIDATION TYPES
// ============================================================

/**
 * Validation issue severity
 */
export type ValidationSeverity = 'error' | 'warning'

/**
 * A single validation issue found in a manifest or package
 */
export interface ManifestValidationIssue {
  readonly severity: ValidationSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
}

/**
 * Result of package validation
 */
export interface PackageValidationResult {
  readonly valid: boolean
  readonly manifest?: PwpackManifest
  readonly issues: readonly ManifestValidationIssue[]
}

// ============================================================
// UPLOAD TYPES
// ============================================================

/**
 * Artifact upload input
 */
export interface ArtifactUploadInput {
  readonly data: Uint8Array
  readonly scope: ArtifactScope
  readonly worldId: string
  readonly publisherId?: string
}

/**
 * Artifact upload result
 */
export interface ArtifactUploadResult {
  readonly artifact: ArtifactDescriptor
  readonly validation: PackageValidationResult
}
