/**
 * Fabric Contract Definitions
 *
 * PHASE0-WS1: Core fabric types for PWFabric
 *
 * This module exports the public fabric contracts. Concerns that belong to a
 * hosting platform — AI model resolution, billing, plans and account
 * aggregates — are not part of it; a host models them in its own types.
 *
 * @module @pwfabric/contracts/fabric
 */

// Contract definitions
export * from './contract.js'

// Capability definitions
export * from './capability.js'

// Config schema types
export * from './config-schema.js'

// Fabric definitions
export * from './fabric.js'

// Surface definitions
export * from './surface.js'

// Manifestation definitions
export * from './manifestation.js'

// Domain definitions
export * from './domain.js'

// Execution types
export * from './execution.js'

// Event types
export * from './events.js'

// Layout types
export * from './layout.js'

// Listings, publishers and licence grants — how a host distributes an atom —
// are not part of this package; the atom itself is described by ./atom.js.
// `ArtifactType` — the atom's KIND — lives in ./artifact.js.

// Artifact types
export * from './artifact.js'

// Dynamic artifact types
export * from './dynamic-artifact.js'

// Surface theme types
export * from './surface-theme.js'

// Appearance cascade — the single theme→CSS implementation.
// Consumed by the renderer, the theme exporter and the composer.
export * from './appearance-cascade.js'
export * from './webfonts.js'

// Canonical block type
export * from './block.js'

// Canonical surface document type
export * from './surface-doc.js'

// Surface event protocol
export * from './surface-events.js'

// Surface render grant
export * from './surface-render-grant.js'

// Surface mutation types
export * from './surface-mutation.js'

// Surface document Zod schemas (moved to contracts)
export * from './surface-schema.js'

// Validation types
export * from './validation.js'

// Block manifest schema
export * from './block-manifest-schema.js'

// Upload limits are not part of this package — a ceiling is a hosting
// policy, so the host owns it.

// Interaction rule types
export * from './interaction-rules.js'

// Pwpack atom types
export * from './atom.js'
// Pack-level dependencies (requires.packs): validation + install closure
export * from './pack-requires.js'
// pwpack.json — the identity file at a pwpack folder's root
export * from './pwpack-json.js'
// media/provenance.json — where each exported media file came from
export * from './media-provenance.js'
// app/media/<key>.json — which image or file an app needs, and its page slots
export * from './media-declaration.js'

// Surface appearance config (data only, no atom engine)
export * from './surface-appearance.js'

// Capability config schemas
export * from './capability-configs.js'

// Account / workspace aggregates (plan, billing, storage, installations) are a
// host's commercial shape, not the fabric's, and are not part of this package.

// Project identity — how an app's visitors sign in
export * from './project-identity.js'
