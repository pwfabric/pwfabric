/**
 * Block Props Validation Tests
 *
 * +. tests cover the post-deletion API where
 * `validateBlockProps` accepts a Zod schema map via `options.schemas`.
 * Without a schema (lenient mode), unknown types pass through; in
 * strict mode they fail.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateBlockProps, validateLayoutProps } from '../validation.js'

const stubSchemas = {
  text: z.object({
    content: z.string().default('Add your text here'),
    fontSize: z.number().default(14),
    fontWeight: z.string().optional(),
  }),
  container: z.object({
    direction: z.enum(['row', 'column']).default('column'),
    gap: z.number().default(16),
    padding: z.number().optional(),
  }),
  button: z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary', 'destructive']).default('primary'),
    size: z.enum(['small', 'medium', 'large']).default('medium'),
  }),
  heading: z.object({
    text: z.string(),
    level: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
  }),
  image: z.object({
    src: z.string(),
    alt: z.string().optional(),
  }),
  grid: z.object({
    columns: z.number().min(1).max(24),
  }),
}

describe('validateBlockProps (with explicit schema map)', () => {
  it('passes valid container props and applies defaults', () => {
    const result = validateBlockProps(
      'container',
      { direction: 'column', gap: 16, padding: 8 },
      { schemas: stubSchemas }
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.coerced?.direction).toBe('column')
  })

  it('applies defaults via coercion for empty props', () => {
    const result = validateBlockProps('text', {}, { schemas: stubSchemas })
    expect(result.valid).toBe(true)
    expect(result.coerced?.content).toBe('Add your text here')
    expect(result.coerced?.fontSize).toBe(14)
  })

  it('catches invalid text fontSize', () => {
    const result = validateBlockProps(
      'text',
      { content: 'Hello', fontSize: 'banana' },
      { schemas: stubSchemas }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('fontSize'))).toBe(true)
  })

  it('catches invalid container direction', () => {
    const result = validateBlockProps(
      'container',
      { direction: 'diagonal' },
      { schemas: stubSchemas }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('catches invalid button variant', () => {
    const result = validateBlockProps(
      'button',
      { label: 'Click', variant: 'neon' },
      { schemas: stubSchemas }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('variant'))).toBe(true)
  })

  it('catches invalid grid columns', () => {
    const result = validateBlockProps('grid', { columns: -999 }, { schemas: stubSchemas })
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
    const result = validateBlockProps('not-in-map', { x: 1 }, { schemas: stubSchemas })
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
      { strict: true, schemas: stubSchemas }
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateLayoutProps', () => {
  it('validates a flat layout', () => {
    const issues = validateLayoutProps(
      { type: 'text', props: { content: 'Hello', fontSize: 16 } },
      { schemas: stubSchemas }
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
      { schemas: stubSchemas }
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
      { schemas: stubSchemas }
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
      { schemas: stubSchemas }
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
