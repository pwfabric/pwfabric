/**
 * Tier 0 — Kernel Capabilities
 *
 * Platform infrastructure that is always active, plan-independent,
 * and non-toggleable. These are NOT capabilities in the entitlement sense —
 * they are substrate components that must be present for any surface to render.
 *
 * Kernel components are NOT shown in a host's plan editor, NOT listed in
 * any pack catalogue, and NOT included in `ALWAYS_ON_CAPABILITY_IDS` or any
 * entitlement check. They exist below the capability tier system.
 *
 * @module @pwfabric/runtime/capability/kernel-capabilities
 * @see — Tier 0: Runtime Infrastructure (Kernel)
 */

/**
 * Canonical list of Tier 0 kernel component identifiers.
 *
 * These are informational — used for documentation, logging, and
 * internal diagnostics. Not checked against any entitlement grant.
 */
export const KERNEL_COMPONENT_IDS = [
  'surface-event-bus',
  'surface-renderer',
  'behavior-surface-provider',
  'capability-kernel',
  'capability-registry',
] as const

export type KernelComponentId = (typeof KERNEL_COMPONENT_IDS)[number]

/**
 * Tier 0 capability ID tokens (Kernel tier).
 *
 * `surface` is the single Tier 0 identifier used in
 * `KERNEL_CAPABILITY_IDS` (bundle-manifests.ts). It represents the
 * capability system bootstrap — the surface itself.
 */
export const KERNEL_CAPABILITY_IDS = ['surface'] as const

export type KernelCapabilityId = (typeof KERNEL_CAPABILITY_IDS)[number]
