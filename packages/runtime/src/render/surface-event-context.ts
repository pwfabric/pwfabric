/**
 * Surface Event Context
 *
 * Re-exports the canonical `SurfaceEventContext` from `@pwfabric/runtime/blocks`.
 * Runtime code that sets the context via
 * `BehaviorSurfaceProvider` and block components that consume it via
 * `useSurfaceEvents` share the same context object through this re-export.
 *
 * @module @pwfabric/runtime/render/surface-event-context
 */

export { SurfaceEventContext } from '../blocks/surface-event-context.js'
