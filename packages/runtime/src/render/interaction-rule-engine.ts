// packages/runtime/src/render/interaction-rule-engine.ts
// DefaultInteractionRuleEngine (formerly DefaultSurfaceBehaviorEngine)

import type {
  InteractionRule,
  InteractionRuleEngine,
  SurfaceEventTrigger,
  SurfaceEventDescriptor,
} from '@pwfabric/contracts'

export type { InteractionRule, InteractionRuleEngine, SurfaceEventTrigger }

export class DefaultInteractionRuleEngine implements InteractionRuleEngine {
  private readonly rules = new Map<string, InteractionRule>()

  register(rule: InteractionRule): void {
    this.rules.set(rule.id, rule)
  }

  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId)
  }

  attach(bus: {
    on(pattern: string, handler: (e: SurfaceEventDescriptor) => void): () => void
  }): () => void {
    const unsubscribers: (() => void)[] = []

    // Group rules by trigger, subscribe once per trigger
    const byTrigger = new Map<string, InteractionRule[]>()
    for (const rule of this.rules.values()) {
      const existing = byTrigger.get(rule.trigger) ?? []
      existing.push(rule)
      byTrigger.set(rule.trigger, existing)
    }

    for (const [trigger, triggerRules] of byTrigger) {
      const unsub = bus.on(trigger, async (event: SurfaceEventDescriptor) => {
        // Sort by priority (higher = first)
        const sorted = [...triggerRules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        for (const rule of sorted) {
          try {
            if (rule.guard && !rule.guard(event)) continue
            await rule.action(event)
          } catch (err) {
            // Fail-safe: log but don't break other rules
            console.warn(`[InteractionRuleEngine] Rule '${rule.id}' failed:`, err)
          }
        }
      })
      unsubscribers.push(unsub)
    }

    return () => unsubscribers.forEach((u) => u())
  }

  clear(): void {
    this.rules.clear()
  }
}

export function createInteractionRuleEngine(): InteractionRuleEngine {
  return new DefaultInteractionRuleEngine()
}
