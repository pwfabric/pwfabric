/**
 * Surface Event Protocol
 *
 * Block event protocol — contractually-defined way for surface
 * blocks to emit events that the BehaviorEngine can respond to.
 *
 * @module @pwfabric/contracts/fabric/surface-events
 */

// ============================================================
// EVENT TYPE CONSTANTS
// ============================================================

/**
 * Built-in surface event type constants.
 * Blocks and the BehaviorEngine reference these strings via this map
 * rather than bare string literals to prevent typos.
 */
export const SURFACE_EVENTS = {
  SURFACE_LOAD: 'surface:load',
  SURFACE_UNLOAD: 'surface:unload',
  BLOCK_CLICK: 'block:click',
  BLOCK_HOVER: 'block:hover',
  FORM_SUBMIT: 'form:submit',
  FORM_CHANGE: 'form:change',
  INPUT_CHANGE: 'input:change',
  MEDIA_PLAY: 'media:play',
  MEDIA_END: 'media:end',
} as const

/**
 * Union of all built-in surface event type strings.
 */
export type SurfaceEventType = (typeof SURFACE_EVENTS)[keyof typeof SURFACE_EVENTS]

// ============================================================
// EVENT DESCRIPTOR
// ============================================================

/**
 * A single event emitted by a surface block.
 *
 * The `type` field accepts both built-in `SurfaceEventType` values and
 * arbitrary strings to allow capability-namespaced events
 * (e.g. `"capability:data-loaded"`).
 */
export interface SurfaceEventDescriptor {
  readonly type: SurfaceEventType | string
  readonly surfaceId: string
  readonly blockId?: string
  readonly payload?: Record<string, unknown>
  readonly timestamp: number
}

// ============================================================
// EVENT BUS INTERFACE
// ============================================================

/**
 * Handler function invoked when a matching event is emitted.
 */
export type SurfaceEventHandler = (event: SurfaceEventDescriptor) => void

/**
 * Function returned by `SurfaceEventBus.on()` that removes the subscription
 * when called.
 */
export type Unsubscribe = () => void

/**
 * Lightweight in-process pub/sub bus scoped to a single rendered surface.
 *
 * - `emit` — broadcast an event to all registered handlers for its type
 * - `on`   — register a handler and receive an unsubscribe function
 * - `off`  — imperatively remove a previously registered handler
 *
 * Implementations must also fire wildcard listeners registered as
 * `"<namespace>:*"` whenever an event whose type starts with that namespace
 * is emitted (e.g. a listener on `"capability:*"` receives all
 * `"capability:…"` events).
 */
export interface SurfaceEventBus {
  emit(event: SurfaceEventDescriptor): void
  on(eventType: string, handler: SurfaceEventHandler): Unsubscribe
  off(eventType: string, handler: SurfaceEventHandler): void
}

// ============================================================
// EVENT NAMESPACE REGISTRY
// ============================================================

import { z } from 'zod'

/**
 * Canonical event namespace registry.
 * Closed list — adding a namespace requires amending.
 */
export const SURFACE_EVENT_NAMESPACE_REGISTRY = {
  'surface:': 'render layer (SurfaceRenderer)',
  'block:': 'block components',
  'form:': 'FormBlock, FormProvider',
  'input:': 'input control blocks',
  'media:': 'media blocks (image, video)',
  'navigation:': 'navigation capability (platform/navigation)',
  'entity:': 'EntityLifecycleEngine + event bridge',
  'capability:': 'capability subsystems (deferred)',
} as const

export type SurfaceEventNamespace = keyof typeof SURFACE_EVENT_NAMESPACE_REGISTRY

/**
 * Zod payload schemas for known event types.
 * Used for dev-mode validation only — no runtime enforcement in prod.
 */
export const SURFACE_EVENT_PAYLOAD_SCHEMAS = {
  'form:submit': z.object({
    values: z.record(z.any()),
    formId: z.string(),
    timestamp: z.number(),
  }),
  'form:change': z.object({
    field: z.string(),
    value: z.any(),
    formId: z.string(),
  }),
  'input:change': z.object({
    value: z.any(),
    inputId: z.string(),
    validationResult: z
      .object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  'entity:created': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    data: z.record(z.any()),
    timestamp: z.number(),
  }),
  'entity:updated': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    data: z.record(z.any()),
    changeset: z.record(z.any()).optional(),
    timestamp: z.number(),
  }),
  'entity:deleted': z.object({
    entityType: z.string(),
    instanceId: z.string(),
    timestamp: z.number(),
  }),
} as const

export type KnownSurfaceEventType = keyof typeof SURFACE_EVENT_PAYLOAD_SCHEMAS
