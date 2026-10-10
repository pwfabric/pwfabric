/**
 * Kernel Capabilities Tests
 *
 * @module @pwfabric/runtime/capability/__tests__/kernel-capabilities
 */

import { describe, it, expect } from 'vitest'
import { KERNEL_COMPONENT_IDS, KERNEL_CAPABILITY_IDS } from '../kernel-capabilities.js'
import type { KernelComponentId, KernelCapabilityId } from '../kernel-capabilities.js'

describe('KERNEL_COMPONENT_IDS', () => {
  it('contains the expected kernel component identifiers', () => {
    expect(KERNEL_COMPONENT_IDS).toContain('surface-event-bus')
    expect(KERNEL_COMPONENT_IDS).toContain('surface-renderer')
    expect(KERNEL_COMPONENT_IDS).toContain('behavior-surface-provider')
    expect(KERNEL_COMPONENT_IDS).toContain('capability-kernel')
    expect(KERNEL_COMPONENT_IDS).toContain('capability-registry')
  })

  it('has 5 entries', () => {
    expect(KERNEL_COMPONENT_IDS).toHaveLength(5)
  })

  it('is a readonly tuple (as const)', () => {
    // TypeScript type guard — value is accessible at runtime
    const ids: readonly string[] = KERNEL_COMPONENT_IDS
    expect(Array.isArray(ids)).toBe(true)
  })
})

describe('KERNEL_CAPABILITY_IDS', () => {
  it('contains surface (auth removed)', () => {
    expect(KERNEL_CAPABILITY_IDS).toContain('surface')
  })

  it('has exactly 1 entry (auth removed from kernel capabilities)', () => {
    expect(KERNEL_CAPABILITY_IDS).toHaveLength(1)
  })
})

describe('KernelComponentId type', () => {
  it('accepts valid kernel component id values', () => {
    const id: KernelComponentId = 'surface-event-bus'
    expect(KERNEL_COMPONENT_IDS).toContain(id)
  })
})

describe('KernelCapabilityId type', () => {
  it('accepts valid kernel capability id values', () => {
    const id: KernelCapabilityId = 'surface'
    expect(KERNEL_CAPABILITY_IDS).toContain(id)
  })
})
