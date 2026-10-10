/**
 * Entity Lifecycle Engine
 *
 * Event-driven logic on entity lifecycle transitions
 * using a trigger-guard-action pattern with priority-based execution.
 *
 * de-behaviorization: `EntityBehavior` renamed to `EntityLifecycleHook`
 * (primary name). `EntityBehavior` kept as deprecated alias for one minor version.
 *
 * @module @pwfabric/runtime/entity/behavior
 */

import type { EntityTypeId, EntityInstanceId } from './types.js'

// ============================================================
// LIFECYCLE TYPES
// ============================================================

/**
 * Entity lifecycle events
 */
export type EntityLifecycleEvent = 'onCreate' | 'onUpdate' | 'onDelete' | 'onRead'

/**
 * Context passed to guards and actions during lifecycle hook execution
 */
export interface EntityBehaviorContext {
  readonly entityType: EntityTypeId
  readonly event: EntityLifecycleEvent
  readonly data: Record<string, unknown>
  readonly previousData?: Record<string, unknown>
  readonly instanceId?: EntityInstanceId
  readonly metadata: Readonly<Record<string, unknown>>
}

/**
 * Guard function that determines whether an action should execute
 */
export type EntityGuard = (context: EntityBehaviorContext) => boolean

/**
 * Action function executed during a lifecycle event
 */
export type EntityAction = (context: EntityBehaviorContext) => void | Promise<void>

/**
 * Entity lifecycle hook definition combining trigger, guard, and action.
 * Primary name de-behaviorization.
 */
export interface EntityLifecycleHook {
  readonly id: string
  readonly entityType: EntityTypeId
  readonly trigger: EntityLifecycleEvent
  readonly guard?: EntityGuard
  readonly action: EntityAction
  readonly priority?: number
}

/**
 * @deprecated Use EntityLifecycleHook instead (de-behaviorization). Will be removed in next minor version.
 */
export type EntityBehavior = EntityLifecycleHook

// ============================================================
// BEHAVIOR ENGINE INTERFACE
// ============================================================

/**
 * @deprecated Use EntityLifecycleEngine instead. Will be removed in next minor version.
 *
 * Engine for registering and executing entity lifecycle hooks
 */
export interface BehaviorEngine {
  /**
   * Register a lifecycle hook
   * @throws Error if a hook with the same id is already registered
   */
  register(hook: EntityLifecycleHook): void

  /**
   * Unregister a hook by id
   */
  unregister(hookId: string): boolean

  /**
   * Execute all matching hooks for an entity type and event.
   * Hooks are executed in priority order (lower priority number = higher precedence).
   * Guards are checked before each action. Async actions are awaited.
   */
  execute(
    entityType: EntityTypeId,
    event: EntityLifecycleEvent,
    context: EntityBehaviorContext
  ): Promise<void>

  /**
   * Get all hooks for an entity type, optionally filtered by event
   */
  getBehaviors(
    entityType: EntityTypeId,
    event?: EntityLifecycleEvent
  ): readonly EntityLifecycleHook[]

  /**
   * Remove all hooks
   */
  clear(): void
}

// ============================================================
// DEFAULT BEHAVIOR ENGINE
// ============================================================

/**
 * @deprecated Use DefaultEntityLifecycleEngine instead. Will be removed in next minor version.
 *
 * Default implementation of BehaviorEngine.
 * Stores hooks in a Map, executes in priority order.
 */
export class DefaultBehaviorEngine implements BehaviorEngine {
  private readonly hooks = new Map<string, EntityLifecycleHook>()

  register(hook: EntityLifecycleHook): void {
    if (!hook.id) {
      throw new Error('Lifecycle hook must have an id')
    }

    if (!hook.entityType) {
      throw new Error('Lifecycle hook must have an entityType')
    }

    if (!hook.trigger) {
      throw new Error('Lifecycle hook must have a trigger')
    }

    if (!hook.action) {
      throw new Error('Lifecycle hook must have an action')
    }

    if (this.hooks.has(hook.id)) {
      throw new Error(`Lifecycle hook '${hook.id}' is already registered`)
    }

    this.hooks.set(hook.id, hook)
  }

  unregister(hookId: string): boolean {
    return this.hooks.delete(hookId)
  }

  async execute(
    entityType: EntityTypeId,
    event: EntityLifecycleEvent,
    context: EntityBehaviorContext
  ): Promise<void> {
    const matching = this.getBehaviors(entityType, event)

    // Sort by priority (lower number = higher precedence, default = 100)
    const sorted = [...matching].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

    for (const hook of sorted) {
      // Check guard
      if (hook.guard) {
        const allowed = hook.guard(context)
        if (!allowed) {
          continue
        }
      }

      // Execute action (await if async)
      await hook.action(context)
    }
  }

  getBehaviors(
    entityType: EntityTypeId,
    event?: EntityLifecycleEvent
  ): readonly EntityLifecycleHook[] {
    const result: EntityLifecycleHook[] = []

    for (const hook of this.hooks.values()) {
      if (hook.entityType !== entityType) {
        continue
      }

      if (event && hook.trigger !== event) {
        continue
      }

      result.push(hook)
    }

    return result
  }

  clear(): void {
    this.hooks.clear()
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * @deprecated Use createEntityLifecycleEngine instead. Will be removed in next minor version.
 *
 * Create a behavior engine
 */
export function createBehaviorEngine(): BehaviorEngine {
  return new DefaultBehaviorEngine()
}

// ============================================================
// PRIMARY NAMES — EntityLifecycleEngine
// ============================================================

/**
 * Entity lifecycle hook engine — manages onCreate/onUpdate/onDelete/onRead hooks.
 * Primary name. Use this instead of BehaviorEngine.
 * @see BehaviorEngine (deprecated alias)
 */
export type EntityLifecycleEngine = BehaviorEngine

/**
 * Entity lifecycle transition type. Use instead of EntityLifecycleEvent
 * when referring to transitions (not bus events).
 */
export type EntityLifecycleTransition = EntityLifecycleEvent

/**
 * Default EntityLifecycleEngine implementation.
 * Primary name.
 */
export class DefaultEntityLifecycleEngine extends DefaultBehaviorEngine {}

/**
 * Factory function for EntityLifecycleEngine.
 * Primary name.
 */
export function createEntityLifecycleEngine(): EntityLifecycleEngine {
  return new DefaultEntityLifecycleEngine()
}
