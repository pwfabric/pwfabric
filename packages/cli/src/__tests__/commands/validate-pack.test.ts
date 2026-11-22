import { describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readPwpack } from '@pwfabric/pack'
import { main } from '../../index.js'
import { archiveName } from '../../commands/pack.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function created(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

describe('pwf validate', () => {
  it('prints the raw result with --json', async () => {
    const { root } = await created()
    const c = capture(root)
    expect(await main(['validate', '--json'], c.io)).toBe(0)
    const result = JSON.parse(c.out.join('\n'))
    expect(result).toMatchObject({ ok: true, layout: 'canonical', identity: { id: '@pwpack/local/demo' } })
    // The atoms/ note is documentation: reported as such, never an error or a warning.
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'info', code: 'DOC_FILE', path: 'atoms/README.md' })])
  })

  it('warns about a pinned build that is not cached', async () => {
    const { root } = await created()
    await rm(join(root, '.pwf'), { recursive: true })
    const c = capture(root)
    expect(await main(['validate'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (1):')
    expect(c.out[1]).toContain('PIN_NOT_CACHED .pwf/packs/@pwpack/fixture/foundation@1.2.0')
    expect(c.out.at(-1)).toContain('valid (0 errors, 1 warning;')
  })

  it('refuses an unknown block type and a block id used twice on a page, with the code and words pwf build uses', async () => {
    const { root } = await created()
    const path = join(root, 'app', 'surfaces', 'home.receipt.json')
    const home = JSON.parse(await readFile(path, 'utf8')) as { blocks: { id: string }[] }
    const first = home.blocks[0]!.id
    await writeFile(
      path,
      JSON.stringify({
        ...home,
        blocks: [
          ...home.blocks,
          { id: 'holo', type: 'hologram', props: {} },
          // Nested: the id is unique within the PAGE, not within its parent.
          { id: 'box', type: 'text', props: { content: 'x' }, children: [{ id: first, type: 'text', props: { content: 'again' } }] },
        ],
      })
    )
    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(1)
    const unknown = v.err.find((l) => l.includes('UNKNOWN_BLOCK_TYPE'))
    const duplicate = v.err.find((l) => l.includes('BLOCK_ID_DUPLICATE'))
    expect(unknown).toBe('  UNKNOWN_BLOCK_TYPE app/surfaces/home.receipt.json: page "home" places a block of type "hologram", which neither the app nor its pinned packs define')
    expect(duplicate).toContain(`block id "${first}" is used twice on this page, at blocks[0] and blocks[${home.blocks.length + 1}].children[0]`)

    // pwf build says the same, word for word.
    const b = capture(root)
    expect(await main(['build'], b.io)).toBe(1)
    const built = b.err.join('\n')
    expect(built).toContain('UNKNOWN_BLOCK_TYPE  page "home" places a block of type "hologram", which neither the app nor its pinned packs define')
    expect(built).toContain(`BLOCK_ID_DUPLICATE  block id "${first}" is used twice on this page, at blocks[0] and blocks[${home.blocks.length + 1}].children[0]`)

    // Fixed, both pass.
    await writeFile(path, JSON.stringify(home))
    expect(await main(['validate'], capture(root).io)).toBe(0)
  })

  it('judges each page in the app layout: its blocks known, the slot no block, ids unique with the layout', async () => {
    const { root } = await created()
    const path = join(root, 'app', 'surfaces', 'home.receipt.json')
    const home = JSON.parse(await readFile(path, 'utf8')) as { blocks: { id: string }[] }
    const first = home.blocks[0]!.id
    const layoutPath = join(root, 'app', 'layout.receipt.json')
    await writeFile(layoutPath, JSON.stringify({ blocks: [{ id: 'chrome', type: 'text', props: { content: 'x' } }, { type: 'pw:page' }] }))
    expect(await main(['validate'], capture(root).io)).toBe(0)

    await writeFile(layoutPath, JSON.stringify({ blocks: [{ id: first, type: 'hologram', props: {} }, { type: 'pw:page' }] }))
    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(1)
    expect(v.err.find((l) => l.includes('UNKNOWN_BLOCK_TYPE'))).toContain('app/layout.receipt.json')
    expect(v.err.find((l) => l.includes('BLOCK_ID_DUPLICATE'))).toContain(`block id "${first}" is used twice on this page`)

    // A page's own members on the layout are refused; its blocks' props are judged like a page's.
    await writeFile(layoutPath, JSON.stringify({ title: 'Site', blocks: [{ id: 'chrome', type: 'text', props: { content: 'x', shade: 1 } }, { type: 'pw:page' }] }))
    const m = capture(root)
    expect(await main(['validate'], m.io)).toBe(1)
    expect(m.err.join(' ')).toContain('APP_LAYOUT_INVALID')
    expect([...m.out, ...m.err].join(' ')).toMatch(/BLOCK_PROP_UNKNOWN app\/layout\.receipt\.json/)

    await writeFile(layoutPath, JSON.stringify({ blocks: [{ id: 'chrome', type: 'text', props: { content: 'x' } }] }))
    const s = capture(root)
    expect(await main(['validate'], s.io)).toBe(1)
    expect(s.err.join(' ')).toContain('APP_LAYOUT_SLOT')
  })

  it('groups errors, warnings and notes and exits 1 on errors', async () => {
    const cwd = await tempDir()
    await mkdir(join(cwd, 'blocks', 'x', 'y'), { recursive: true })
    await writeFile(join(cwd, 'blocks', 'x', 'y', 'component.tsx'), '')
    await writeFile(join(cwd, 'package.json'), '{}')
    await writeFile(join(cwd, 'pwpack.json'), JSON.stringify({ id: '@pwpack/a/b', version: '1.0.0', app: { entry: 'home', surfaceOrder: ['home'] } }))
    const c = capture(cwd)
    expect(await main(['validate'], c.io)).toBe(1)
    expect(c.err[0]).toBe('Errors (2):')
    expect(c.err.join(' ')).toContain('APP_SURFACE_MISSING app/surfaces/home.receipt.json')
    // No plan, so no words: the runner's not-found page would be blank (E-4).
    expect(c.err.join(' ')).toContain('MESSAGES_MISSING app/plan.json')
    expect(c.out).toContain('Warnings (1):')
    expect(c.out).toContain('Notes (1):')
    expect(c.err.at(-1)).toContain('@pwpack/a/b@1.0.0: invalid (2 errors, 1 warning; layout rootless; 1 atoms)')
  })

  it('warns about block props that do not fit the manifests of the app and its packs', async () => {
    const { root } = await created()
    const pill = join(root, 'atoms', 'blocks', 'custom', 'pill')
    await mkdir(pill, { recursive: true })
    await writeFile(join(pill, 'component.tsx'), 'export default function Pill() { return null }')
    await writeFile(
      join(pill, 'manifest.json'),
      JSON.stringify({
        id: 'custom.pill',
        kind: 'block',
        version: '1.0.0',
        name: 'pill',
        state: 'stable',
        knowledge: { purpose: 'p', useCases: ['u'], composesWith: [], antiPatterns: ['a'] },
        definition: {
          props: [
            { name: 'size', jsonSchema: { type: 'string', enum: ['small', 'medium', 'large'] } },
            { name: 'count', jsonSchema: { type: 'number' } },
          ],
          defaultProps: {},
          canHaveChildren: false,
        },
      })
    )
    const receiptPath = join(root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.blocks.push(
      { id: 'p1', type: 'pill', props: { size: 'sm', count: '3' } },
      { id: 'p2', type: 'pill', props: { size: '{{state.size}}', count: 'n: {{state.n}}' } },
      { id: 'b1', type: 'button', props: { label: 'Go', size: 'sm' } }
    )
    await writeFile(receiptPath, JSON.stringify(receipt))

    const c = capture(root)
    expect(await main(['validate'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (3):')
    expect(c.out.slice(1, 4)).toEqual([
      expect.stringContaining('BLOCK_PROP_ENUM app/surfaces/home.receipt.json: blocks['),
      expect.stringContaining('BLOCK_PROP_TYPE app/surfaces/home.receipt.json'),
      expect.stringContaining('BLOCK_PROP_UNKNOWN app/surfaces/home.receipt.json'),
    ])
    expect(c.out[1]).toContain('(pill "p1") sets size = "sm", which custom.pill does not accept (allowed: "small", "medium", "large")')
    expect(c.out[3]).toContain('(button "b1") sets "size", which control.button does not declare (its props: label, href)')

    const j = capture(root)
    expect(await main(['validate', '--json'], j.io)).toBe(0)
    const result = JSON.parse(j.out.join('\n'))
    expect(result.ok).toBe(true)
    expect(result.issues.filter((i: { code: string }) => i.code.startsWith('BLOCK_PROP_')).map((i: { severity: string }) => i.severity)).toEqual([
      'warning',
      'warning',
      'warning',
    ])
  })

  it('warns about a {{…}} in a bindable: false prop, nested too, and not in a bindable one', async () => {
    const { root } = await created()
    const sample = join(root, 'atoms', 'blocks', 'custom', 'sample')
    await mkdir(sample, { recursive: true })
    await writeFile(join(sample, 'component.tsx'), 'export default function Sample() { return null }')
    await writeFile(
      join(sample, 'manifest.json'),
      JSON.stringify({
        id: 'custom.sample',
        kind: 'block',
        version: '1.0.0',
        name: 'sample',
        state: 'stable',
        knowledge: { purpose: 'p', useCases: ['u'], composesWith: [], antiPatterns: ['a'] },
        definition: {
          props: [
            { name: 'code', bindable: false, jsonSchema: { type: 'string' } },
            { name: 'steps', bindable: false, jsonSchema: { type: 'array' } },
            { name: 'title', jsonSchema: { type: 'string' } },
          ],
          defaultProps: {},
          canHaveChildren: false,
        },
      })
    )
    const receiptPath = join(root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.blocks.push(
      { id: 's1', type: 'sample', props: { code: 'Hello {{state.name}}', title: '{{state.title}}' } },
      { id: 's2', type: 'sample', props: { code: 'plain', steps: [{ say: 'no braces' }, { say: '{{ item.x }}' }] } },
      { id: 's3', type: 'sample', props: { code: 'plain', steps: ['{a}'], title: 'x {{state.t}}' } }
    )
    await writeFile(receiptPath, JSON.stringify(receipt))

    const c = capture(root)
    expect(await main(['validate'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (2):')
    expect(c.out[1]).toContain(
      'BLOCK_PROP_NOT_BINDABLE app/surfaces/home.receipt.json: blocks[3] (sample "s1") sets code to "Hello {{state.name}}", but custom.sample declares code bindable: false; the {{…}} is not resolved and renders as written'
    )
    expect(c.out[2]).toContain('BLOCK_PROP_NOT_BINDABLE app/surfaces/home.receipt.json: blocks[4] (sample "s2") sets steps[1].say to "{{ item.x }}"')
    expect(c.out.at(-1)).toContain('valid (0 errors, 2 warnings;')
  })

  it('checks the receipts of a pack that is not an app, and nothing without an identity', async () => {
    const cwd = await tempDir()
    const receipt = JSON.stringify({ blocks: [{ type: 'pill', props: { nope: 1 } }] })
    await mkdir(join(cwd, 'app', 'surfaces'), { recursive: true })
    await mkdir(join(cwd, 'atoms', 'blocks', 'custom', 'pill'), { recursive: true })
    await writeFile(join(cwd, 'atoms', 'blocks', 'custom', 'pill', 'component.tsx'), '')
    await writeFile(join(cwd, 'atoms', 'blocks', 'custom', 'pill', 'manifest.json'), JSON.stringify({ definition: { props: [] } }))
    await writeFile(join(cwd, 'app', 'surfaces', 'x.receipt.json'), receipt)
    const blockCodes = async (): Promise<string[]> => {
      const c = capture(cwd)
      await main(['validate', '--json'], c.io)
      return JSON.parse(c.out.join('\n')).issues.map((i: { code: string }) => i.code).filter((code: string) => code.startsWith('BLOCK_PROP_'))
    }
    expect(await blockCodes()).toEqual([])
    await writeFile(join(cwd, 'pwpack.json'), JSON.stringify({ id: '@pwpack/a/b', version: '1.0.0' }))
    expect(await blockCodes()).toEqual(['BLOCK_PROP_UNKNOWN'])
  })

  it('reports an unusable pin id as an error', async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, 'pwpack.json'), JSON.stringify({ id: '@pwpack/a/b', version: '1.0.0', packs: [{ id: '../x', version: '1.0.0', hash: 'h' }] }))
    const c = capture(cwd)
    expect(await main(['validate', '--json'], c.io)).toBe(1)
    expect(JSON.parse(c.out.join('\n')).issues[0]).toMatchObject({ code: 'PIN_INVALID', severity: 'error' })
  })

  it('warns about a row field the bound source does not have, and keeps the exit code', async () => {
    const { root } = await created()
    await mkdir(join(root, 'app', 'definitions'), { recursive: true })
    await writeFile(
      join(root, 'app', 'definitions', 'entities.json'),
      JSON.stringify({ entities: [{ typeId: 'Product', fields: [{ name: 'name', type: 'text' }] }] })
    )
    await writeFile(
      join(root, 'app', 'definitions', 'auth.json'),
      JSON.stringify({ access: { rules: [{ subject: 'public', model: 'Product', rule: 'read' }] } })
    )
    // The fixture foundation has no repeater: the app brings its own (a block type nobody defines is an error).
    const repeater = join(root, 'atoms', 'blocks', 'layout', 'repeater')
    await mkdir(repeater, { recursive: true })
    await writeFile(
      join(repeater, 'manifest.json'),
      JSON.stringify({ id: 'layout.repeater', kind: 'block', version: '1.0.0', category: 'layout', name: 'repeater', state: 'stable', knowledge: { purpose: 'Test repeater' }, definition: { props: [], canHaveChildren: true } })
    )
    await writeFile(join(repeater, 'component.tsx'), "export default function Block(): string {\n  return ''\n}\n")
    const home = JSON.parse(await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8'))
    const receipt = (field: string) => ({
      ...home,
      blocks: [
        ...home.blocks,
        { id: 'list', type: 'repeater', repeat: '{{products}}', children: [{ id: 'n', type: 'text', props: { content: `{{item.${field}}}` } }] },
      ],
      capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'products', kind: 'entity', entityType: 'Product' }] } }],
    })
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), JSON.stringify(receipt('title')))
    const c = capture(root)
    expect(await main(['validate'], c.io)).toBe(0)
    expect(c.out.filter((l) => l.includes('FIELD_UNKNOWN'))).toEqual([
      expect.stringContaining('FIELD_UNKNOWN app/surfaces/home.receipt.json: surface "home", block "n" reads field "title" of source "products"'),
    ])
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), JSON.stringify(receipt('name')))
    const d = capture(root)
    expect(await main(['validate'], d.io)).toBe(0)
    expect(d.out.join('\n')).not.toContain('FIELD_UNKNOWN')
  })

  it('knows a connector-served source by the entities its engine declares', async () => {
    const { root } = await created()
    await mkdir(join(root, 'app', 'definitions'), { recursive: true })
    await mkdir(join(root, 'atoms', 'connectors'), { recursive: true })
    await writeFile(join(root, 'app', 'definitions', 'connections.json'), JSON.stringify({ connections: [{ name: 'tasks', connector: 'graph-tasks' }] }))
    const engine = (entities: unknown) =>
      JSON.stringify({
        id: 'Tasks',
        kind: 'connector',
        version: '1.0.0',
        name: 'Tasks',
        state: 'stable',
        knowledge: { summary: 'Tasks.' },
        connection: 'graph-tasks',
        ...(entities !== undefined ? { entities } : {}),
      })
    await writeFile(join(root, 'atoms', 'connectors', 'Tasks.knowledge.json'), engine([{ entityType: 'TodoTasks', fields: [{ name: 'title', type: 'text' }] }]))
    const home = JSON.parse(await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8'))
    const receipt = (field: string, connector = 'tasks') => ({
      ...home,
      blocks: [
        ...home.blocks,
        { id: 'list', type: 'repeater', repeat: '{{todo}}', children: [{ id: 'n', type: 'text', props: { content: `{{item.${field}}}` } }] },
      ],
      capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'todo', kind: 'entity', entityType: 'TodoTasks', connector }] } }],
    })
    const findings = async (): Promise<string[]> => {
      const c = capture(root)
      await main(['validate'], c.io)
      return c.out.filter((l) => l.includes('FIELD_UNKNOWN'))
    }
    const write = (r: unknown) => writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), JSON.stringify(r))

    await write(receipt('title'))
    expect(await findings()).toEqual([])
    await write(receipt('dueDate'))
    expect(await findings()).toEqual([
      expect.stringContaining(
        'reads field "dueDate" of source "todo", whose rows have no such field (known from the entity "TodoTasks" of connection "tasks" (atoms/connectors/Tasks.knowledge.json): id, title)'
      ),
    ])
    // A connector the app does not declare as a connection: not checked.
    await write(receipt('dueDate', 'graph-tasks'))
    expect(await findings()).toEqual([])
    // An engine that declares no entities: its row fields are unknown.
    await write(receipt('dueDate'))
    await writeFile(join(root, 'atoms', 'connectors', 'Tasks.knowledge.json'), engine([]))
    expect(await findings()).toEqual([])
  })

  it('names the folder when there is no identity, and fails on a missing folder', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['validate'], c.io)).toBe(1)
    expect(c.err.at(-1)).toContain(`${cwd}: invalid`)
    const d = capture(cwd)
    expect(await main(['validate', 'missing'], d.io)).toBe(1)
    expect(d.err[0]).toContain('pwf validate: not a directory')
  })
})

describe('pwf pack', () => {
  it('writes <name>-<version>.pwpack into the folder by default and leaves out the cache', async () => {
    const { cwd, root } = await created()
    const c = capture(cwd)
    expect(await main(['pack', 'demo'], c.io)).toBe(0)
    const out = join(root, 'demo-0.1.0.pwpack')
    expect(c.out).toContain(`  file  ${out}`)
    expect(c.out.find((l) => l.startsWith('  size'))).toMatch(/^ {2}size {2}\d+ bytes, 6 files$/)
    const files = [...(await readPwpack(new Uint8Array(await readFile(out)))).files.keys()]
    expect(files.some((f) => f.startsWith('.pwf') || f === '.gitignore')).toBe(false)
    // The atoms/ note is pack content (documentation) and travels with the pack.
    expect(files).toContain('atoms/README.md')
    // packing again does not pack the previous archive
    const again = capture(cwd)
    expect(await main(['pack', 'demo'], again.io)).toBe(0)
    expect(again.out.find((l) => l.startsWith('  hash'))).toBe(c.out.find((l) => l.startsWith('  hash')))
  })

  it('neither packs nor reports dot entries at the root', async () => {
    const { root } = await created()
    await writeFile(join(root, '.editorconfig'), 'root = true')
    await mkdir(join(root, '.vscode'), { recursive: true })
    await writeFile(join(root, '.vscode', 'settings.json'), '{}')
    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(0)
    expect(v.out.at(-1)).toContain('(0 errors, 0 warnings;')
    const c = capture(root)
    expect(await main(['pack', '--out', '../dots.pwpack'], c.io)).toBe(0)
    const files = [...(await readPwpack(new Uint8Array(await readFile(join(root, '..', 'dots.pwpack'))))).files.keys()]
    expect(files.some((f) => f.startsWith('.'))).toBe(false)
  })

  it('prints warnings but still packs', async () => {
    const { root } = await created()
    await writeFile(join(root, 'notes.txt'), 'x')
    const c = capture(root)
    expect(await main(['pack', '--out', 'out/x.pwpack'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (1):')
    expect(existsSync(join(root, 'out', 'x.pwpack'))).toBe(true)
  })

  it('packs the pack content only: tooling is left out and does not change the hash', async () => {
    const { root } = await created()
    const before = capture(root)
    expect(await main(['pack', '--out', '../a.pwpack'], before.io)).toBe(0)
    await writeFile(join(root, 'package.json'), '{"name":"demo"}')
    await mkdir(join(root, 'scripts'), { recursive: true })
    await writeFile(join(root, 'scripts', 'build.mjs'), '// tooling')
    const after = capture(root)
    expect(await main(['pack', '--out', '../b.pwpack'], after.io)).toBe(0)
    expect(after.out.find((l) => l.startsWith('  size'))).toMatch(/6 files \(2 outside the pack content left out\)$/)
    expect(after.out.find((l) => l.startsWith('  hash'))).toBe(before.out.find((l) => l.startsWith('  hash')))
    const files = [...(await readPwpack(new Uint8Array(await readFile(join(root, '..', 'b.pwpack'))))).files.keys()]
    expect(files).not.toContain('package.json')
    expect(files.some((f) => f.startsWith('scripts/'))).toBe(false)
  })

  it('names archives after the last id segment', () => {
    expect(archiveName('@pwpack/example/cards', '1.2.0')).toBe('cards-1.2.0.pwpack')
    expect(archiveName('@solo', '1.0.0')).toBe('solo-1.0.0.pwpack')
    expect(archiveName('', '1.0.0')).toBe('pack-1.0.0.pwpack')
  })
})
