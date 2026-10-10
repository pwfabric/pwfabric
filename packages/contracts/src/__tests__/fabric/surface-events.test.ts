/**
 * Surface Events Tests
 *
 * Covers SURFACE_EVENTS constant and related types.
 *
 * @module @pwfabric/contracts/fabric/__tests__/surface-events
 */

import { describe, it, expect } from 'vitest'
import { SURFACE_EVENTS, type SurfaceEventType } from '../../fabric/surface-events.js'

describe('SURFACE_EVENTS', () => {
  it('should export all built-in event type constants', () => {
    expect(SURFACE_EVENTS.SURFACE_LOAD).toBe('surface:load')
    expect(SURFACE_EVENTS.SURFACE_UNLOAD).toBe('surface:unload')
    expect(SURFACE_EVENTS.BLOCK_CLICK).toBe('block:click')
    expect(SURFACE_EVENTS.BLOCK_HOVER).toBe('block:hover')
    expect(SURFACE_EVENTS.FORM_SUBMIT).toBe('form:submit')
    expect(SURFACE_EVENTS.FORM_CHANGE).toBe('form:change')
    expect(SURFACE_EVENTS.INPUT_CHANGE).toBe('input:change')
    expect(SURFACE_EVENTS.MEDIA_PLAY).toBe('media:play')
    expect(SURFACE_EVENTS.MEDIA_END).toBe('media:end')
  })

  it('should have exactly 9 event constants', () => {
    expect(Object.keys(SURFACE_EVENTS)).toHaveLength(9)
  })

  it('should use colon-namespaced string values', () => {
    for (const value of Object.values(SURFACE_EVENTS)) {
      expect(value).toMatch(/^[a-z]+:[a-z]+$/)
    }
  })

  it('should be usable as SurfaceEventType values', () => {
    const type: SurfaceEventType = SURFACE_EVENTS.BLOCK_CLICK
    expect(type).toBe('block:click')
  })

  it('should cover all namespace groups', () => {
    const values = Object.values(SURFACE_EVENTS) as string[]
    const namespaces = new Set(values.map((v) => v.split(':')[0]))
    expect(namespaces).toContain('surface')
    expect(namespaces).toContain('block')
    expect(namespaces).toContain('form')
    expect(namespaces).toContain('input')
    expect(namespaces).toContain('media')
  })
})
