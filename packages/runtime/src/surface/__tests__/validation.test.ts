/**
 * Block Props Validation Tests
 *
 * `validateBlockProps` reads the block manifests' declared props
 * (`options.manifests`) — no validation library. Without a manifest
 * (lenient mode), unknown types pass through; in strict mode they fail.
 */

import { describe, it, expect } from 'vitest'
import type { BlockManifestPropsMap } from '../validation.js'
import { validateBlockProps, validateLayoutProps } from '../validation.js'

const str = { type: 'string' } as const
const num = { type: 'number' } as const
const stubManifests: BlockManifestPropsMap = {
  text: [
    { name: 'content', default: 'Add your text here', jsonSchema: str },
    { name: 'fontSize', default: 14, jsonSchema: num },
    { name: 'fontWeight', jsonSchema: str },
  ],
  container: [
    { name: 'direction', default: 'column', jsonSchema: { type: 'string', enum: ['row', 'column'] } },
    { name: 'gap', default: 16, jsonSchema: num },
    { name: 'padding', jsonSchema: num },
  ],
  button: [
    { name: 'label', required: true, jsonSchema: str },
    { name: 'variant', default: 'primary', jsonSchema: { type: 'string', enum: ['primary', 'secondary', 'destructive'] } },
    { name: 'size', default: 'medium', jsonSchema: { type: 'string', enum: ['small', 'medium', 'large'] } },
  ],
  heading: [
    { name: 'text', required: true, jsonSchema: str },
    { name: 'level', required: true, jsonSchema: { type: 'string', enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] } },
  ],
  image: [
    { name: 'src', required: true, jsonSchema: str },
    { name: 'alt', jsonSchema: str },
  ],
  grid: [{ name: 'columns', required: true, jsonSchema: { type: 'number', minimum: 1, maximum: 24 } }],
}

describe('validateBlockProps (with a manifest map)', () => {
  it('passes valid container props and applies defaults', () => {
    const result = validateBlockProps(
      'container',
      { direction: 'column', gap: 16, padding: 8 },
      { manifests: stubManifests }
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.coerced?.direction).toBe('column')
  })

  it('applies defaults via coercion for empty props', () => {
    const result = validateBlockProps('text', {}, { manifests: stubManifests })
    expect(result.valid).toBe(true)
    expect(result.coerced?.content).toBe('Add your text here')
    expect(result.coerced?.fontSize).toBe(14)
  })

  it('catches invalid text fontSize', () => {
    const result = validateBlockProps(
      'text',
      { content: 'Hello', fontSize: 'banana' },
      { manifests: stubManifests }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('fontSize'))).toBe(true)
  })

  it('catches invalid container direction', () => {
    const result = validateBlockProps(
      'container',
      { direction: 'diagonal' },
      { manifests: stubManifests }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('catches invalid button variant', () => {
    const result = validateBlockProps(
      'button',
      { label: 'Click', variant: 'neon' },
      { manifests: stubManifests }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('variant'))).toBe(true)
  })

  it('catches invalid grid columns', () => {
    const result = validateBlockProps('grid', { columns: -999 }, { manifests: stubManifests })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('validateBlockProps — schema-less paths', () => {
  it('passes through unknown types in lenient mode (default, no schemas)', () => {
    const result = validateBlockProps('custom-widget', { anything: 'goes', count: 42 })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.coerced).toBeUndefined()
  })

  it('passes through types absent from the schema map (lenient with map)', () => {
    const result = validateBlockProps('not-in-map', { x: 1 }, { manifests: stubManifests })
    expect(result.valid).toBe(true)
  })

  it('fails unknown types in strict mode', () => {
    const result = validateBlockProps('custom-widget', { anything: 'goes' }, { strict: true })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Unknown block type')
  })

  it('fails strict mode when type is missing from schema map', () => {
    const result = validateBlockProps(
      'not-in-map',
      { x: 1 },
      { strict: true, manifests: stubManifests }
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateLayoutProps', () => {
  it('validates a flat layout', () => {
    const issues = validateLayoutProps(
      { type: 'text', props: { content: 'Hello', fontSize: 16 } },
      { manifests: stubManifests }
    )
    expect(issues).toHaveLength(0)
  })

  it('validates a nested layout', () => {
    const issues = validateLayoutProps(
      {
        type: 'container',
        props: { direction: 'column' },
        children: [
          { type: 'text', props: { content: 'Hello' } },
          { type: 'button', props: { label: 'Click' } },
        ],
      },
      { manifests: stubManifests }
    )
    expect(issues).toHaveLength(0)
  })

  it('reports issues with path context', () => {
    const issues = validateLayoutProps(
      {
        type: 'container',
        props: { direction: 'column' },
        children: [{ type: 'text', props: { fontSize: 'banana' } }],
      },
      { manifests: stubManifests }
    )
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]?.path).toBe('root.children[0]')
    expect(issues[0]?.type).toBe('text')
  })

  it('reports multiple issues from nested tree', () => {
    const issues = validateLayoutProps(
      {
        type: 'container',
        props: { direction: 'invalid' },
        children: [
          { type: 'text', props: { fontSize: 'banana' } },
          { type: 'button', props: { variant: 'neon' } },
        ],
      },
      { manifests: stubManifests }
    )
    expect(issues.length).toBe(3)
    expect(issues[0]?.path).toBe('root')
    expect(issues[1]?.path).toBe('root.children[0]')
    expect(issues[2]?.path).toBe('root.children[1]')
  })

  it('lenient mode passes everything through when no schemas supplied', () => {
    const issues = validateLayoutProps({
      type: 'container',
      props: { direction: 'invalid' },
      children: [{ type: 'text', props: { fontSize: 'banana' } }],
    })
    expect(issues).toHaveLength(0)
  })
})
