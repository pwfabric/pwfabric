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
export * from './app-layout.js'
export * from './app-locales.js'

// Listings, publishers and licence grants — how a host distributes an atom —
// are not part of this package; the atom itself is described by ./atom.js.
// `ArtifactType` — the atom's KIND — lives in ./artifact.js.

// Artifact types
export * from './artifact.js'

// Dynamic artifact types
export * from './dynamic-artifact.js'

export * from './block-prop.js'

// Surface theme types
export * from './surface-theme.js'

// Appearance cascade — the single theme→CSS implementation.
// Consumed by the renderer, the theme exporter and the composer.
export * from './appearance-cascade.js'
export * from './block-tokens.js'

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

// The record write contract: server-owned fields, declared types, undeclared
// fields refused — one function for every server that hosts an app's records.
// A server's, so its functions are `@pwfabric/contracts/record-write`.
export type * from './record-write.js'

// Validation types
export * from './validation.js'

// Block manifest schema
export * from './block-manifest-schema.js'

// Upload limits are not part of this package — a ceiling is a hosting
// policy, so the host owns it.

// Interaction rule types
export * from './interaction-rules.js'

// Pwpack atom types, and pack-level dependencies (requires.packs). What reads a
// pack's files — the compiler, the pack tools, an install — imports their
// functions from `@pwfabric/contracts/pack`; a visitor's page never reads a
// pack, and this root is what every page carries whole (embed.js exposes it
// to blocks). The types stay here.
export type * from './atom.js'
export type * from './pack-requires.js'
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
