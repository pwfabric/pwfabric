import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { codeFallbacksOf } from '../../commands/lib/migrate-blocks.js'
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

  it('writes the merged props: shape from the schema, default reported, schema-only constraints left out; bindable, copy and prose from the manifest', async () => {
    const { root, manifest } = await pack()
    const c = capture(root)
    expect(await main(['migrate', 'blocks', root], c.io)).toBe(0)
    const props = (JSON.parse(await readFile(manifest, 'utf8')) as typeof MANIFEST).definition.props as Record<string, unknown>[]
    const by = Object.fromEntries(props.map((p) => [p['name'], p]))
    expect(by['text']).toEqual({ name: 'text', type: 'string', default: '', bindable: true, copy: true, jsonSchema: { type: 'string', description: 'The label.' } })
    // The render never applied the schema's 'md': the manifest's default stays, the disagreement is a finding.
    expect(by['size']).toMatchObject({ default: 'sm', type: '"sm" | "md" | "lg"', bindable: false, jsonSchema: { type: 'string', enum: ['sm', 'md', 'lg'] } })
    // .int().min(0).max(96): never enforced at render, and the manifest had none of it.
    expect(by['gap']).toEqual({ name: 'gap', type: 'number', default: 8, jsonSchema: { type: 'number' } })
    // .url() and required: never enforced at render; an href-like prop takes "/x" too.
    expect(by['href']).toEqual({ name: 'href', type: 'string', bindable: true, jsonSchema: { type: 'string' } })
    expect(by['items']).toEqual({
      name: 'items',
      type: '{ label?: string; open?: boolean }[]',
      bindable: true,
      default: [],
      jsonSchema: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, open: { type: 'boolean', default: false } } } },
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

/** One block folder with this component source and these manifest props. */
async function block(name: string, component: string, props: unknown[]): Promise<{ root: string; manifest: string }> {
  const root = await tempDir()
  const dir = join(root, 'blocks', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'component.tsx'), component)
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ id: `x.${name}`, kind: 'block', version: '1.0.0', name, definition: { props } }, null, 2))
  return { root, manifest }
}

async function migrated(root: string, manifest: string): Promise<{ by: Record<string, Record<string, unknown>>; text: string }> {
  const c = capture(root)
  expect(await main(['migrate', 'blocks', root], c.io)).toBe(0)
  const props = (JSON.parse(await readFile(manifest, 'utf8')) as { definition: { props: Record<string, unknown>[] } }).definition.props
  return { by: Object.fromEntries(props.map((p) => [p['name'] as string, p])), text: c.text() }
}

describe('pwf migrate blocks — what rendered before 3.0 was the code, not the schema', () => {
  // The render path never parsed props with zod: a grid with no `gap` drew the
  // component's own `?? 'var(--pw-layout-grid-gap)'`, not the schema's 16.
  const GRID = `import { z } from 'zod'
import { cssUnit } from './units.js'
export const gridPropsSchema = z.object({
  columns: z.number().default(2),
  gap: z.union([z.number(), z.string()]).default(16),
  rowGap: z.coerce.number().default(8),
  label: z.string().default('Grid'),
  tone: z.string().default('plain'),
})
export const Grid = ({ props }) => {
  const columns = (props.columns as number) ?? 2
  const { label = 'Items', tone: kind = "quiet" } = props
  return { gap: cssUnit(props.gap as CSSUnit) ?? 'var(--pw-layout-grid-gap)', row: props.rowGap ?? 'var(--row)', columns, label, kind }
}
`
  it("reads the component's literal fallbacks: `props.x ?? <literal>` (through `as` and a call) and destructuring defaults", () => {
    const found = codeFallbacksOf(GRID)
    expect(found.get('gap')).toEqual(['var(--pw-layout-grid-gap)'])
    expect(found.get('columns')).toEqual([2])
    expect(found.get('label')).toEqual(['Items'])
    expect(found.get('tone')).toEqual(['quiet'])
    expect(found.get('rowGap')).toEqual(['var(--row)'])
    expect(codeFallbacksOf('const a = props.x ?? other; const b = props.y ?? props.z')).toEqual(new Map())
    expect(codeFallbacksOf('const a = props.n ?? 1; const b = props.n ?? 2').get('n')).toEqual([1, 2])
  })

  it("writes the code's fallback as the default, reports the schema's, and writes none when the code's does not fit the shape", async () => {
    const { root, manifest } = await block('grid', GRID, [
      { name: 'gap', type: 'number | string', default: 16, jsonSchema: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
      { name: 'rowGap', type: 'number', default: 8, jsonSchema: { type: 'number' } },
      { name: 'label', type: 'string', copy: true, jsonSchema: { type: 'string' } },
    ])
    await writeFile(join(root, 'blocks', 'grid', 'units.ts'), 'export const cssUnit = (v: unknown) => v\n')
    const { by, text } = await migrated(root, manifest)
    expect(by['gap']?.['default']).toBe('var(--pw-layout-grid-gap)')
    expect(text).toMatch(/default: gap: default 16 in the schema, the code falls back to "var\(--pw-layout-grid-gap\)" \(what drew\) — the code's/)
    // A number prop whose code falls back to a CSS variable: no default, so the block's own `??` keeps drawing it.
    expect(by['rowGap']?.['default']).toBeUndefined()
    expect(text).toMatch(/rowGap: the code's fallback "var\(--row\)" does not fit the shape — no default written/)
    expect(by['label']?.['default']).toBe('Items')
    expect(by['columns']?.['default']).toBe(2)
    expect(text).not.toMatch(/default: columns/)
    // Only in the schema; the renamed destructuring default wins.
    expect(by['tone']?.['default']).toBe('quiet')
    const again = capture(root)
    expect(await main(['migrate', 'blocks', root, '--check'], again.io)).toBe(0)
  })

  it('reports a default the schema alone gives as a finding to review', async () => {
    const { root, manifest } = await block(
      'chip',
      `import { z } from 'zod'\nexport const chipPropsSchema = z.object({ size: z.enum(['sm', 'md']).default('md') })\nexport const Chip = ({ props }) => String(props.size)\n`,
      [{ name: 'size', type: '"sm" | "md"', jsonSchema: { type: 'string', enum: ['sm', 'md'] } }]
    )
    const { by, text } = await migrated(root, manifest)
    expect(by['size']?.['default']).toBe('md')
    expect(text).toMatch(/default: size: default "md" from the schema only — the render never applied it/)
  })
})

describe('pwf migrate blocks — a constraint the render never enforced is not written silently', () => {
  const LINKS = `import { z } from 'zod'
export const linksPropsSchema = z.object({
  href: z.string().url(),
  website: z.string().url().optional(),
  image: z.string().url().or(z.literal('')).default(''),
  count: z.number().int().min(0).max(10).optional(),
  name: z.string().min(1).optional(),
  rows: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
})
export const Links = () => null
`
  it('writes a format, `.int()`, a bound or a required member only where the manifest had it, and never `uri` on a link', async () => {
    const { root, manifest } = await block('links', LINKS, [
      { name: 'href', type: 'string', jsonSchema: { type: 'string', format: 'uri' } },
      { name: 'website', type: 'string', jsonSchema: { type: 'string', format: 'uri' } },
      { name: 'image', type: 'string', jsonSchema: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'string', const: '' }] } },
      { name: 'count', type: 'number', jsonSchema: { type: 'integer', minimum: 0 } },
      { name: 'name', type: 'string', jsonSchema: { type: 'string' } },
      { name: 'rows', type: '{ id: string }[]', jsonSchema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    ])
    const { by, text } = await migrated(root, manifest)
    // href-like: "/menu" and "#/x" are links, even though the manifest said uri.
    expect(by['href']).toEqual({ name: 'href', type: 'string', jsonSchema: { type: 'string' } })
    expect(text).toMatch(/constraint: href: format "uri" — a link takes "\/x" and "#\/x" too \(an href-like name\); not written/)
    expect(text).toMatch(/constraint: href: required — schema-only constraint, not written/)
    // Not a link name, and the manifest had it: kept.
    expect(by['website']?.['jsonSchema']).toEqual({ type: 'string', format: 'uri' })
    // A `.url()` beside a '' branch: never uri.
    expect(by['image']?.['jsonSchema']).toEqual({ anyOf: [{ type: 'string' }, { type: 'string', const: '' }] })
    // The manifest had integer and a minimum, not the maximum.
    expect(by['count']?.['jsonSchema']).toEqual({ type: 'integer', minimum: 0 })
    expect(text).toMatch(/constraint: count: maximum 10 — schema-only constraint, not written/)
    expect(by['name']?.['jsonSchema']).toEqual({ type: 'string' })
    expect(text).toMatch(/constraint: name: minLength 1 — schema-only constraint, not written/)
    expect((by['rows']?.['jsonSchema'] as { items: { required: string[] } }).items.required).toEqual(['id'])
    expect(text).toMatch(/constraint: rows\[\]\.title: required member — schema-only constraint, not written/)
  })

  it('leaves `.int()` out of a prop the manifest never declared integer', async () => {
    const { root, manifest } = await block(
      'pager',
      `import { z } from 'zod'\nexport const pagerPropsSchema = z.object({ page: z.number().int().default(1) })\nexport const Pager = () => null\n`,
      [{ name: 'page', type: 'number', jsonSchema: { type: 'number' } }]
    )
    const { by, text } = await migrated(root, manifest)
    expect(by['page']?.['jsonSchema']).toEqual({ type: 'number' })
    expect(text).toMatch(/constraint: page: integer \(\.int\(\)\) — schema-only constraint, not written \(number\)/)
  })
})

describe('pwf migrate blocks — the shape the schema cannot say, and the type string', () => {
  const TREE = `import { z } from 'zod'
const node = z.object({ id: z.string(), label: z.string(), get children() { return z.array(node).optional() } })
export const treeViewPropsSchema = z.object({
  items: z.array(node).default([]),
  itemId: z.union([z.string(), z.number()]).optional(),
})
export const TreeView = () => null
`
  const ITEMS = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, children: { type: 'array' } } } }
  const PROPS = [
    { name: 'items', type: 'TreeNode[]', default: [], jsonSchema: ITEMS },
    { name: 'itemId', type: 'string', jsonSchema: { type: 'string' } },
  ]

  it("keeps the manifest's shape where the schema's is recursive ($ref)", async () => {
    const { root, manifest } = await block('tree-view', TREE, PROPS)
    const { by, text } = await migrated(root, manifest)
    expect(by['items']).toEqual({ name: 'items', type: 'TreeNode[]', default: [], jsonSchema: ITEMS })
    expect(text).toMatch(/unrepresentable: items: the schema's shape cannot be written as a prop shape — the manifest's kept/)
  })

  it('regenerates the human type string when the shape changed under it', async () => {
    const { root, manifest } = await block('tree-view', TREE, PROPS)
    const { by, text } = await migrated(root, manifest)
    expect(by['itemId']).toEqual({ name: 'itemId', type: 'string | number', jsonSchema: { type: ['string', 'number'] } })
    expect(text).toMatch(/type-string: itemId: type "string" no longer says the shape — regenerated as "string \| number"/)
  })
})
