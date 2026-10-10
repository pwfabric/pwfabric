/**
 * @pwfabric/runtime/blocks
 *
 * Core UI block schemas, definitions, and React components for the PWFabric platform.
 *
 * @module @pwfabric/runtime/blocks
 */

// `./blocks/*` directory deleted — first-party block
// components live exclusively in `pwpack-source/<pack>/blocks/<cat>/<name>/component.tsx`
// and are loaded at runtime through the dynamic install pipeline.
export * from './registry.js'
export * from './composition-rules.js'
export * from './rule-engine.js'
export * from './component-types.js'
export { SurfaceEventContext } from './surface-event-context.js'
export { SurfaceIdContext } from './surface-id-context.js'
export { useSurfaceEvents, useSurfaceId } from './hooks.js'

// The test fixtures (populateTestBlocks, TEST_BLOCK_DEFINITIONS) are NOT
// exported: tests import ./__test-fixtures__/block-fixtures.js directly, and
// the published package does not ship that folder. Block metadata reaches a
// running app through the install pipeline (`useInstalledAtoms` in the
// browser, `installedBlocksOverride` on the server).
