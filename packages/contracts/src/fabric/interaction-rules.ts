// packages/contracts/src/fabric/interaction-rules.ts
// InteractionRule types

import type { SurfaceEventDescriptor } from './surface-events.js'

/**
 * Surface-level interaction event trigger types (namespace registry).
 * These are the event types that InteractionRuleEngine can subscribe to.
 */
export type SurfaceEventTrigger =
  | 'surface:mount'
  | 'surface:unmount'
  | 'block:click'
  | 'block:hover'
  | 'form:submit'
  | 'form:change'
  | 'navigation:before'
  | 'navigation:after'

/**
 * A single surface-level interaction rule.
 */
export interface InteractionRule {
  readonly id: string
  readonly trigger: SurfaceEventTrigger
  readonly guard?: (event: SurfaceEventDescriptor) => boolean
  readonly action: (event: SurfaceEventDescriptor) => void | Promise<void>
  readonly priority?: number
}

/**
 * Engine that evaluates interaction rules against surface events.
 */
export interface InteractionRuleEngine {
  register(rule: InteractionRule): void
  unregister(ruleId: string): boolean
  /** Attach to SurfaceEventBus — returns unsubscribe function. */
  attach(bus: {
    on(pattern: string, handler: (e: SurfaceEventDescriptor) => void): () => void
  }): () => void
  clear(): void
}
