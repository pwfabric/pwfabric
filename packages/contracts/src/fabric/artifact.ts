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
 * - `pwfpack` — retired single-manifest package (see the note below)
 */
export type ArtifactType = 'pwfpack' | 'starter' | 'block' | 'capability' | 'bundle'

// ============================================================
// PACKAGE MANIFEST
// ============================================================
//
// @deprecated SINGLE-MANIFEST (.pwfpkg) FORMAT — RETIRED. The canonical
// deployment unit is the atoms[] pwpack
// (`PwpackManifest` / `AtomRef` in ./atom.ts), packaged, published and
// bundled per-atom (esbuild → CDN). `provides` / `entryPoints`
// / `manifestVersion` are no longer produced or consumed. These types are kept
// (contracts are immutable — physical removal requires a contracts major),
// but MUST NOT be used by new code.

/**
 * Author information in manifest
 * @deprecated single-manifest format — use the atoms[] pwpack pipeline.
 */
export interface ManifestAuthor {
  readonly name: string
  readonly email?: string
  readonly url?: string
}

/**
 * What a package provides (grants to installers)
 * @deprecated single-manifest format — atoms[] pwpack lists atoms directly.
 */
export interface ArtifactProvides {
  readonly blocks?: readonly string[]
  readonly starters?: readonly string[]
  readonly capabilities?: readonly string[]
}

/**
 * What a package requires (dependencies)
 */
export interface ArtifactRequires {
  readonly blocks?: readonly string[]
  readonly capabilities?: readonly string[]
}

/**
 * Module entry points
 * @deprecated single-manifest format — atoms[] pwpack bundles per-atom.
 */
export interface ArtifactEntryPoints {
  readonly main: string
  readonly renderer?: string
  readonly editor?: string
  readonly server?: string
}

/**
 * Package manifest schema (pwfabric.manifest.json)
 * @deprecated single-manifest format — use `PwpackManifest` (atoms[]) in ./atom.ts.
 */
export interface PackageManifest {
  readonly manifestVersion: number
  readonly name: string
  readonly version: SemanticVersion
  readonly description: string
  readonly type: ArtifactType
  readonly provides: ArtifactProvides
  readonly requires?: ArtifactRequires
  readonly entryPoints: ArtifactEntryPoints
  readonly author: ManifestAuthor
  readonly license?: string
  readonly keywords?: readonly string[]
  readonly repository?: string
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
  readonly manifest: PackageManifest
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
  readonly manifest?: PackageManifest
  readonly issues: readonly ManifestValidationIssue[]
}

// ============================================================
// PUBLISHER EXTENSION TYPES
// ============================================================

/**
 * Publisher approval status
 *
 * @deprecated Platform concept; leaves the open contract surface at the next major. Hosts should model it in their own types.
 */
export type PublisherStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

/**
 * Publisher registration input
 *
 * @deprecated Platform concept; leaves the open contract surface at the next major. Hosts should model it in their own types.
 */
export interface PublisherRegistration {
  readonly name: string
  readonly slug: string
  readonly description?: string
  readonly website?: string
  readonly contactEmail?: string
}

/**
 * Extended publisher descriptor (extends marketplace PublisherDescriptor)
 *
 * @deprecated Platform concept; leaves the open contract surface at the next major. Hosts should model it in their own types.
 */
export interface ExtendedPublisherDescriptor {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly worldId: string
  readonly verified: boolean
  readonly status: PublisherStatus
  readonly description?: string
  readonly website?: string
  readonly contactEmail?: string
  readonly createdAt: number
  readonly updatedAt: number
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
