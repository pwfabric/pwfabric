/**
 * Surface Primitives Tests
 *
 * @module @pwfabric/runtime/surface/__tests__/primitives
 */

import { describe, it, expect } from 'vitest'
import {
  container,
  button,
  divider,
  heading,
  spacer,
  getPrimitiveDefinition,
  isPrimitive,
} from '../primitives.js'

// ============================================================
// container
// ============================================================

describe('container()', () => {
  it('creates a container node with children', () => {
    const child = { type: 'text' as const, props: { content: 'hi' }, children: [] }
    const node = container([child])
    expect(node.type).toBe('container')
    expect(node.children).toHaveLength(1)
    expect(node.props).toEqual({})
  })

  it('creates a container node with props', () => {
    const node = container([], { direction: 'row' })
    expect(node.props).toMatchObject({ direction: 'row' })
  })
})

// ============================================================
// button
// ============================================================

describe('button()', () => {
  it('creates a button node with label', () => {
    const node = button('Click me')
    expect(node.type).toBe('button')
    expect(node.props).toMatchObject({ label: 'Click me' })
  })

  it('creates a button node with extra props', () => {
    const node = button('Submit', { variant: 'primary', disabled: true })
    expect(node.props).toMatchObject({ label: 'Submit', variant: 'primary', disabled: true })
  })
})

// ============================================================
// heading
// ============================================================

describe('heading()', () => {
  it('creates a heading node with level and content', () => {
    const node = heading(1, 'Title')
    expect(node.type).toBe('heading')
    expect(node.props).toMatchObject({ level: 1, content: 'Title' })
  })

  it('accepts extra props', () => {
    const node = heading(2, 'Subtitle', { id: 'sub' })
    expect(node.props).toMatchObject({ level: 2, content: 'Subtitle', id: 'sub' })
  })
})

// ============================================================
// spacer
// ============================================================

describe('spacer()', () => {
  it('creates a spacer node with size', () => {
    const node = spacer(16)
    expect(node.type).toBe('spacer')
    expect(node.props).toMatchObject({ size: 16 })
  })

  it('creates a spacer node with size and direction', () => {
    const node = spacer('2rem', 'vertical')
    expect(node.props).toMatchObject({ size: '2rem', direction: 'vertical' })
  })
})

// ============================================================
// divider
// ============================================================

describe('divider()', () => {
  it('creates a divider node with no props', () => {
    const node = divider()
    expect(node.type).toBe('divider')
    expect(node.props).toEqual({})
  })

  it('creates a divider node with orientation prop', () => {
    const node = divider({ orientation: 'horizontal' })
    expect(node.type).toBe('divider')
    expect(node.props).toMatchObject({ orientation: 'horizontal' })
  })

  it('creates a divider node with variant prop', () => {
    const node = divider({ variant: 'dashed' })
    expect(node.props).toMatchObject({ variant: 'dashed' })
  })
})

// ============================================================
// getPrimitiveDefinition
// ============================================================

describe('getPrimitiveDefinition()', () => {
  it('returns definition for text primitive', () => {
    const def = getPrimitiveDefinition('text')
    expect(def).toBeDefined()
    expect(def?.type).toBe('text')
  })

  it('returns definition for container primitive', () => {
    const def = getPrimitiveDefinition('container')
    expect(def).toBeDefined()
  })

  it('returns definition for divider primitive', () => {
    const def = getPrimitiveDefinition('divider')
    expect(def).toBeDefined()
    expect(def?.type).toBe('divider')
  })
})

// ============================================================
// isPrimitive
// ============================================================

describe('isPrimitive()', () => {
  it('returns true for known primitive types', () => {
    expect(isPrimitive('text')).toBe(true)
    expect(isPrimitive('divider')).toBe(true)
    expect(isPrimitive('container')).toBe(true)
  })

  it('returns false for unknown type', () => {
    expect(isPrimitive('unknown-type')).toBe(false)
  })
})
