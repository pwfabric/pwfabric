/**
 * resolveCapability / listCapabilities tests
 *
 * Post-cutover contract: the hardcoded fallback is gone. The lookup
 * function is required; a registry miss is a hard error.
 *
 * @module @pwfabric/runtime/capability/__tests__/resolve-capability
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveCapability, listCapabilities } from '../index.js'

describe('resolveCapability (registry-only)', () => {
  it('returns the capability when the lookup yields a hit', async () => {
    const fake = { id: 'platform/navigation' } as never
    const lookup = vi.fn().mockResolvedValue(fake)
    const result = await resolveCapability('platform/navigation', 't1', lookup)
    expect(result).toBe(fake)
    expect(lookup).toHaveBeenCalledWith('platform/navigation', 't1')
  })

  it('throws when the lookup returns null (no fallback)', async () => {
    await expect(resolveCapability('platform/navigation', 't1', async () => null)).rejects.toThrow(
      /not installed for tenant/
    )
  })

  it('throws with a descriptive message that names the missing capability and tenant', async () => {
    await expect(
      resolveCapability('platform/unknown', 'tenant-x', async () => null)
    ).rejects.toThrow(/"platform\/unknown".*"tenant-x"/)
  })
})

describe('listCapabilities (registry-only)', () => {
  it('returns whatever the lookup yields', async () => {
    const fakes = [{ id: 'platform/navigation' }] as never
    const list = vi.fn().mockResolvedValue(fakes)
    const result = await listCapabilities('t1', list)
    expect(result).toBe(fakes)
    expect(list).toHaveBeenCalledWith('t1')
  })

  it('returns empty when the tenant has nothing installed', async () => {
    const result = await listCapabilities('t1', async () => [])
    expect(result).toEqual([])
  })
})
