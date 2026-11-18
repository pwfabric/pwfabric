/**
 * `@pwfabric/contracts/pack` — what reads a pack's files.
 *
 * The atom contract (kinds, file classification, block origins, engine and
 * sibling entries) and pack-level dependencies (`requires.packs`: validation
 * and the install closure). The compiler, the pack tools and an install
 * import these; a visitor's page never reads a pack, so they are not in the
 * package root, which every page carries whole (embed.js exposes it to
 * blocks). The root still exports every TYPE declared here.
 *
 * @module @pwfabric/contracts/pack
 */
export * from './fabric/atom.js'
export * from './fabric/pack-requires.js'
