import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { capture, tempDir } from './helpers.js'

/** A pre-3.0 block: a zod schema in the component and a manifest that drifted from it. */
const COMPONENT = `import { z } from 'zod'
import * as React from 'react'
import { useSurfaceEvents } from '@pwfabric/runtime'
import { sizes } from '../../../lib/sizes.js'

export const badgePropsSchema = z.object({
  text: z.string().default(''),
  size: z.enum(sizes).default('md'),
  gap: z.number().int().min(0).max(96).default(8),
  href: z.string().url(),
  items: z.array(z.object({ label: z.string(), open: z.boolean().default(false) })).default([]),
  map: z.record(z.string(), z.enum(['a', 'b'])).optional(),
})

export const badgeDefinition = { type: 'badge', name: 'Badge', schema: badgePropsSchema, defaultProps: { text: '' } }

export const Badge = ({ props }: { props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  return <span onClick={() => emit({})}>{String(props.text)}</span>
}
Object.assign(Badge, { sizing: 'intrinsic' })
`

const MANIFEST = {
  id: 'control.badge',
  kind: 'block',
  version: '1.0.0',
  name: 'badge',
  definition: {
    props: [
      { name: 'text', type: 'string', default: '', bindable: true, copy: true, jsonSchema: { type: 'string', description: 'The label.' } },
      { name: 'size', type: '"sm" | "md"', default: 'sm', bindable: false, jsonSchema: { type: 'string', enum: ['sm', 'md'] } },
      { name: 'gap', type: 'string', jsonSchema: { type: 'string' } },
      { name: 'legacy', type: 'boolean', jsonSchema: { type: 'boolean' } },
    ],
    defaultProps: { text: '' },
    canHaveChildren: false,
  },
}

async function pack(): Promise<{ root: string; manifest: string }> {
  const root = await tempDir()
  const dir = join(root, 'atoms', 'blocks', 'control', 'badge')
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, 'atoms', 'lib'), { recursive: true })
  await writeFile(join(root, 'atoms', 'lib', 'sizes.ts'), `export const sizes = ['sm', 'md', 'lg'] as const\n`)
  await writeFile(join(dir, 'component.tsx'), COMPONENT)
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, JSON.stringify(MANIFEST, null, 2))
  return { root, manifest }
}

describe('pwf migrate blocks', () => {
  it('reports every disagreement between the schema and the manifest, and changes nothing with --check', async () => {
    const { root, manifest } = await pack()
    const c = capture(root)
    expect(await main(['migrate', 'blocks', '.', '--check'], c.io)).toBe(1)
    const text = c.text()
    expect(text).toContain('atoms/blocks/control/badge: would change (schema badgeDefinition.schema')
    expect(text).toMatch(/default: size: default "sm" in the manifest, "md" in the schema/)
    expect(text).toMatch(/enum: size: values \["sm","md"\] in the manifest, \["sm","md","lg"\] in the schema/)
    expect(text).toMatch(/type: gap: type string in the manifest, number in the schema/)
    expect(text).toMatch(/only-in-manifest: legacy/)
    expect(text).toMatch(/only-in-schema: href/)
    expect(text).toMatch(/only-in-schema: items/)
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual(MANIFEST)
  })

  it('writes the merged props: shape, default and required from the schema; bindable, copy and prose from the manifest', async () => {
    const { root, manifest } = await pack()
    const c = capture(root)
    expect(await main(['migrate', 'blocks', root], c.io)).toBe(0)
    const props = (JSON.parse(await readFile(manifest, 'utf8')) as typeof MANIFEST).definition.props as Record<string, unknown>[]
    const by = Object.fromEntries(props.map((p) => [p['name'], p]))
    expect(by['text']).toEqual({ name: 'text', type: 'string', default: '', bindable: true, copy: true, jsonSchema: { type: 'string', description: 'The label.' } })
    expect(by['size']).toMatchObject({ default: 'md', bindable: false, jsonSchema: { type: 'string', enum: ['sm', 'md', 'lg'] } })
    expect(by['gap']).toMatchObject({ default: 8, jsonSchema: { type: 'integer', minimum: 0, maximum: 96 } })
    expect(by['href']).toMatchObject({ required: true, jsonSchema: { type: 'string', format: 'uri' } })
    expect(by['items']).toMatchObject({
      default: [],
      jsonSchema: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, open: { type: 'boolean', default: false } }, required: ['label'] } },
    })
    expect(by['map']).toMatchObject({ jsonSchema: { type: 'object', additionalProperties: { type: 'string', enum: ['a', 'b'] } } })
    expect((by['map'] as { jsonSchema: Record<string, unknown> }).jsonSchema['propertyNames']).toBeUndefined()
    expect(by['legacy']).toEqual(MANIFEST.definition.props[3])
    // A second run finds nothing left to change.
    const again = capture(root)
    expect(await main(['migrate', 'blocks', root, '--check'], again.io)).toBe(0)
    expect(again.text()).toContain('agrees')
  })

  it('says so for a block that has no schema left', async () => {
    const { root } = await pack()
    await writeFile(join(root, 'atoms', 'blocks', 'control', 'badge', 'component.tsx'), 'export const Badge = () => null\n')
    const c = capture(root)
    expect(await main(['migrate', 'blocks', root], c.io)).toBe(0)
    expect(c.text()).toContain('no props schema')
  })

  it('refuses an unknown subject', async () => {
    const c = capture(await tempDir())
    expect(await main(['migrate', 'receipts'], c.io)).toBe(2)
  })
})
