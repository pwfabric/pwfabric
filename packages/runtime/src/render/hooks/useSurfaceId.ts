/**
 * useSurfaceId hook
 *
 * Re-exports from `@pwfabric/runtime/blocks` (its canonical home).
 * Read from the module itself, not the `blocks` barrel: the barrel also
 * carries the composition rule engine, which no visitor's page runs, and
 * this hook is on every page.
 *
 * @module @pwfabric/runtime/render/hooks/useSurfaceId
 */

export { useSurfaceId } from '../../blocks/hooks.js'
