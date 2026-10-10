/**
 * Capability Canonicalization — Drift Guard
 *
 * + +. The canonical capability set is exactly 4.
 *   platform/persistence, platform/entities, platform/navigation,
 *   platform/interaction.
 *
 * This test locks the 4-item canonical set and asserts that:
 *   - `platformCapabilities` array (source of truth) has exactly 4 entries
 *   - All IDs follow the `platform/` prefix convention
 *   - Previously removed capabilities never leak back:
 * platform/auth, ai/*,
 *       platform/analytics, platform/seo, platform/i18n, platform/routing,
 * platform/input
 *   - `CANONICAL_CAPABILITY_IDS` derived export matches the array
 *   - `CAPABILITY_COUNT` === 4
 *
 * If this test fails, a governance-approved ADR is required before changing
 * the canonical set. Update this snapshot only as part of that ADR.
 *
 * @module @pwfabric/runtime/capability/__tests__/canonicalization
 */

import { describe, it, expect } from 'vitest'
import { platformCapabilities, CANONICAL_CAPABILITY_IDS, CAPABILITY_COUNT } from '../index.js'

describe('Capability canonicalization', () => {
  const EXPECTED_CANONICAL_IDS = [
    'platform/entities',
    'platform/interaction',
    'platform/navigation',
    'platform/persistence',
  ] as const

  const REMOVED_IDS = [
    // phantom auth capability
    'platform/auth',
    // AI capability wrappers (moved to plan.featureAiComposer flag)
    'ai/content',
    'ai/style',
    'ai/compose',
    'ai/spawn',
    // Tier 3 deferred, removed from registry
    'platform/analytics',
    'platform/seo',
    'platform/i18n',
    // routing renamed to navigation
    'platform/routing',
    // deprecated aliases merged into persistence/interaction
    'platform/data',
    'platform/state',
    'platform/forms',
    'platform/behaviors',
    // hard cutover; form writes via platform/entities
    'platform/input',
  ] as const

  it('platformCapabilities has exactly 4 entries', () => {
    expect(platformCapabilities).toHaveLength(4)
  })

  it('CAPABILITY_COUNT equals 4', () => {
    expect(CAPABILITY_COUNT).toBe(4)
  })

  it('CANONICAL_CAPABILITY_IDS derives from platformCapabilities', () => {
    expect(CANONICAL_CAPABILITY_IDS).toHaveLength(4)
    expect([...CANONICAL_CAPABILITY_IDS].sort()).toEqual([...EXPECTED_CANONICAL_IDS])
  })

  it('platformCapabilities IDs match canonical snapshot', () => {
    const ids = platformCapabilities.map((c) => c.id).sort()
    expect(ids).toEqual([...EXPECTED_CANONICAL_IDS])
  })

  it('all canonical IDs use the platform/ prefix', () => {
    for (const cap of platformCapabilities) {
      expect(cap.id).toMatch(/^platform\//)
    }
  })

  it.each(REMOVED_IDS)('removed capability "%s" does NOT leak back', (removedId) => {
    const ids = platformCapabilities.map((c) => c.id)
    expect(ids).not.toContain(removedId)
    expect(CANONICAL_CAPABILITY_IDS).not.toContain(removedId)
  })
})
