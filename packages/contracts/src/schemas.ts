/**
 * @pwfabric/contracts/schemas — the contracts' zod schemas.
 *
 * Tooling only: the CLI, `pwf validate`/`pwf build`, a hosting service and
 * tests parse documents with these. The package root (`@pwfabric/contracts`)
 * exports no zod value, so the visitor bundle (`embed.js`), which carries the
 * root, never loads zod. The types these schemas infer stay exported from the
 * root.
 *
 * @module @pwfabric/contracts/schemas
 */

export * from './fabric/atom.schema.js'
export * from './fabric/block-manifest-schema.schema.js'
export * from './fabric/capability-configs.schema.js'
export * from './fabric/media-declaration.schema.js'
export * from './fabric/media-provenance.schema.js'
export * from './fabric/pack-requires.schema.js'
export * from './fabric/project-identity.schema.js'
export * from './fabric/pwpack-json.schema.js'
export * from './fabric/surface-appearance.schema.js'
export * from './fabric/surface-events.schema.js'
export * from './fabric/surface-schema.schema.js'
export * from './fabric/validation.schema.js'
