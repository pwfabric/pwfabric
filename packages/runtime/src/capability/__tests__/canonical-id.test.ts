/**
 * Either spelling, one answer.
 *
 * Both spellings are legitimate and both occur in real documents. The plan
 * layer's contract types the short one; the registry, the pack's capability
 * atoms and the drift guard all use the long one. So a reader that accepts
 * only one is blind to real, correctly-authored surfaces: a declared data
 * source goes unseen, the entity facade is never built, and the app draws
 * empty panels.
 *
 * @module @pwfabric/runtime/capability/__tests__/canonical-id
 */
import { describe, it, expect } from 'vitest'

import { canonicalCapabilityId, isCapability } from '../type-mapping.js'
import { CANONICAL_CAPABILITY_IDS } from '../index.js'

describe('canonicalCapabilityId', () => {
  it('answers the same id for the short and the long spelling', () => {
    expect(canonicalCapabilityId('persistence')).toBe('platform/persistence')
    expect(canonicalCapabilityId('platform/persistence')).toBe('platform/persistence')
    expect(canonicalCapabilityId('entities')).toBe('platform/entities')
    expect(canonicalCapabilityId('platform/entities')).toBe('platform/entities')
  })

  it('covers every canonical capability, in both spellings', () => {
    // Guards the pairing against the drift guard's own list: a fifth
    // capability added without a short form would fail here rather than
    // quietly become unreachable to half the readers.
    for (const id of CANONICAL_CAPABILITY_IDS) {
      expect(canonicalCapabilityId(id)).toBe(id)
      const short = id.slice(id.indexOf('/') + 1)
      expect(canonicalCapabilityId(short)).toBe(id)
    }
  })

  it('refuses a retired name rather than passing it through', () => {
    // `platform/auth` was removed as a phantom and `platform/input` retired;
    // `seo` never existed. Returning them unchanged would let a ghost keep
    // looking like a capability to every caller downstream.
    for (const ghost of ['auth', 'platform/auth', 'input', 'platform/input', 'seo', 'platform/seo']) {
      expect(canonicalCapabilityId(ghost)).toBeNull()
    }
  })

  it('treats blank and unknown as no capability', () => {
    expect(canonicalCapabilityId('')).toBeNull()
    expect(canonicalCapabilityId('   ')).toBeNull()
    expect(canonicalCapabilityId('nonesuch')).toBeNull()
  })
})

describe('isCapability', () => {
  it('matches an entry however it spelled itself', () => {
    expect(isCapability({ capability: 'persistence' }, 'platform/persistence')).toBe(true)
    expect(isCapability({ capability: 'platform/persistence' }, 'persistence')).toBe(true)
  })

  it('does not match a different capability, or a ghost', () => {
    expect(isCapability({ capability: 'navigation' }, 'platform/persistence')).toBe(false)
    expect(isCapability({ capability: 'auth' }, 'platform/auth')).toBe(false)
    expect(isCapability(null, 'platform/persistence')).toBe(false)
    expect(isCapability({}, 'platform/persistence')).toBe(false)
  })
})
