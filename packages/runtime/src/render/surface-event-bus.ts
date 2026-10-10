/**
 * Surface Event Bus Implementation
 *
 * In-process pub/sub bus scoped to a single rendered surface.
 *
 * @module @pwfabric/runtime/render/surface-event-bus
 */

import type {
  SurfaceEventBus,
  SurfaceEventDescriptor,
  SurfaceEventHandler,
  Unsubscribe,
} from '@pwfabric/contracts'

/**
 * Create a new `SurfaceEventBus` instance.
 *
 * Each surface renderer creates its own bus so that events from one surface
 * do not leak into sibling or parent surfaces.
 *
 * Wildcard support: listeners registered as `"<namespace>:*"` (e.g.
 * `"capability:*"`) receive every event whose type starts with that namespace
 * prefix (e.g. `"capability:data-loaded"`).
 */
export function createSurfaceEventBus(): SurfaceEventBus {
  const handlers = new Map<string, Set<SurfaceEventHandler>>()

  return {
    emit(event: SurfaceEventDescriptor): void {
      // Dev-mode payload validation — async/lazy, does not block emit
      if (process.env.NODE_ENV === 'development') {
        // Import lazily to avoid prod bundle size impact
        void import('@pwfabric/contracts').then(({ SURFACE_EVENT_PAYLOAD_SCHEMAS }) => {
          const schema =
            SURFACE_EVENT_PAYLOAD_SCHEMAS[event.type as keyof typeof SURFACE_EVENT_PAYLOAD_SCHEMAS]
          if (schema && event.payload !== undefined) {
            const result = schema.safeParse(event.payload)
            if (!result.success) {
              console.warn(
                `[SurfaceEventBus] Payload validation warning for '${event.type}':`,
                result.error.flatten()
              )
            }
          }
        })
      }

      // Exact-match listeners
      const exactSet = handlers.get(event.type)
      if (exactSet) {
        exactSet.forEach((h) => h(event))
      }

      // Wildcard listeners for the namespace prefix (e.g. "block:*")
      const ns = event.type.split(':')[0]
      const wildcardSet = handlers.get(`${ns}:*`)
      if (wildcardSet) {
        wildcardSet.forEach((h) => h(event))
      }

      // Global wildcard "*" — every event. The surface renderer subscribes its
      // single event handler here so block-emitted events (with their full
      // payload, incl. a declarative `action`) reach the action dispatcher. This
      // is what lets a form's submit→setState run via the canonical bus path
      // instead of the retired legacy `context.onEvent` shim.
      const globalSet = handlers.get('*')
      if (globalSet) {
        globalSet.forEach((h) => h(event))
      }
    },

    on(eventType: string, handler: SurfaceEventHandler): Unsubscribe {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, new Set())
      }
      handlers.get(eventType)?.add(handler)
      return () => handlers.get(eventType)?.delete(handler)
    },

    off(eventType: string, handler: SurfaceEventHandler): void {
      handlers.get(eventType)?.delete(handler)
    },
  }
}
