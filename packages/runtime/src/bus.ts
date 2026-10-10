/**
 * Event Bus
 *
 * Event bus for fabric communication
 *
 * @module @pwfabric/runtime/bus
 */

import type {
  BaseEvent,
  EventBus,
  EventHandler,
  EventSubscription,
  EventFilter,
  FabricEvent,
} from '@pwfabric/contracts'
import { generateEventId } from '@pwfabric/contracts'

// ============================================================
// IN-MEMORY EVENT BUS IMPLEMENTATION
// ============================================================

/**
 * Subscription entry
 */
interface SubscriptionEntry {
  readonly id: string
  readonly handler: EventHandler<BaseEvent>
  readonly filter: EventFilter | undefined
}

/**
 * In-memory event bus implementation
 */
export class InMemoryEventBus implements EventBus {
  private subscriptions: SubscriptionEntry[] = []
  private typeSubscriptions = new Map<string, Set<SubscriptionEntry>>()

  emit<E extends BaseEvent>(event: E): void {
    // Emit to type-specific subscribers
    const typeHandlers = this.typeSubscriptions.get(event.type)
    if (typeHandlers) {
      for (const entry of typeHandlers) {
        this.invokeHandler(entry.handler, event)
      }
    }

    // Emit to general subscribers
    for (const entry of this.subscriptions) {
      if (this.matchesFilter(event, entry.filter)) {
        this.invokeHandler(entry.handler, event)
      }
    }
  }

  subscribe<E extends BaseEvent>(
    handler: EventHandler<E>,
    filter?: EventFilter
  ): EventSubscription {
    const entry: SubscriptionEntry = {
      id: generateEventId(),
      handler: handler as EventHandler<BaseEvent>,
      filter,
    }

    this.subscriptions.push(entry)

    return {
      unsubscribe: () => {
        const index = this.subscriptions.indexOf(entry)
        if (index !== -1) {
          this.subscriptions.splice(index, 1)
        }
      },
    }
  }

  on<E extends BaseEvent>(type: E['type'], handler: EventHandler<E>): EventSubscription {
    const entry: SubscriptionEntry = {
      id: generateEventId(),
      handler: handler as EventHandler<BaseEvent>,
      filter: undefined,
    }

    let typeSet = this.typeSubscriptions.get(type)
    if (!typeSet) {
      typeSet = new Set()
      this.typeSubscriptions.set(type, typeSet)
    }
    typeSet.add(entry)

    return {
      unsubscribe: () => {
        const set = this.typeSubscriptions.get(type)
        if (set) {
          set.delete(entry)
          if (set.size === 0) {
            this.typeSubscriptions.delete(type)
          }
        }
      },
    }
  }

  once<E extends BaseEvent>(type: E['type'], handler: EventHandler<E>): EventSubscription {
    const subscription = this.on(type, (event) => {
      subscription.unsubscribe()
      handler(event as E)
    })
    return subscription
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscriptions = []
    this.typeSubscriptions.clear()
  }

  /**
   * Get subscription count
   */
  subscriptionCount(): number {
    let count = this.subscriptions.length
    for (const set of this.typeSubscriptions.values()) {
      count += set.size
    }
    return count
  }

  private matchesFilter(event: BaseEvent, filter?: EventFilter): boolean {
    if (!filter) return true

    // Check type filter
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event.type)) {
        return false
      }
    }

    // Check source filter
    if (filter.sources && filter.sources.length > 0) {
      const eventSource = event.source
      const matches = filter.sources.some((source) => {
        if (source.fabricId && source.fabricId !== eventSource.fabricId) {
          return false
        }
        if (source.capabilityId && source.capabilityId !== eventSource.capabilityId) {
          return false
        }
        if (source.domainId && source.domainId !== eventSource.domainId) {
          return false
        }
        return true
      })
      if (!matches) return false
    }

    return true
  }

  private invokeHandler(handler: EventHandler<BaseEvent>, event: BaseEvent): void {
    try {
      const result = handler(event)
      // Handle async handlers - errors are swallowed but could be logged
      if (result instanceof Promise) {
        result.catch(() => {
          // Handler error - could log here
        })
      }
    } catch {
      // Handler threw synchronously - could log here
    }
  }
}

/**
 * Create a new event bus
 */
export function createEventBus(): EventBus {
  return new InMemoryEventBus()
}

// ============================================================
// TYPED EVENT EMITTERS
// ============================================================

/**
 * Helper to create a typed event
 */
export function createFabricEvent<T extends FabricEvent['type']>(
  type: T,
  data: Omit<Extract<FabricEvent, { type: T }>, 'id' | 'type' | 'timestamp'>
): Extract<FabricEvent, { type: T }> {
  return {
    id: generateEventId(),
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<FabricEvent, { type: T }>
}
