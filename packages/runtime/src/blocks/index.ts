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

// canonical test fixture — opt-in for suites that
// exercise registry-dependent behaviour (BlockRegistry, rule engine,
// composer prompt, block introspection). Production code must NOT
// import this; the install pipeline supplies block metadata via
// `useInstalledAtoms` (browser) / `installedBlocksOverride` (server).
export { populateTestBlocks, TEST_BLOCK_DEFINITIONS } from './__test-fixtures__/block-fixtures.js'
