/**
 * `pwf mcp` through a real MCP client over the SDK's in-memory transport:
 * the tools as a client lists them, a whole create → add block → validate →
 * build → pack round on a temporary folder, and the failures a model meets.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandFailure } from '../../commands/lib/failure.js'
import { createPwfMcpServer, failureAnswer, SERVER_INSTRUCTIONS, TOOLS } from '../../mcp/index.js'
import { isInside, writeTarget } from '../../mcp/paths.js'
import { FIXTURE_FOUNDATION, tempDir } from '../commands/helpers.js'

const K_PACK = join(FIXTURE_FOUNDATION, '..', 'k-pack')

interface Answer {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}

const clients: Client[] = []

async function connect(): Promise<Client> {
  const server = createPwfMcpServer({ version: '0.0.0-test' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  clients.push(client)
  return client
}

afterEach(async () => {
  while (clients.length) await (clients.pop() as Client).close()
})

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Answer> {
  return (await client.callTool({ name, arguments: args })) as unknown as Answer
}

const text = (a: Answer): string => a.content.map((c) => c.text).join('\n')

describe('pwf mcp', () => {
  it('tells every client what it is and lists the tools with their schemas', async () => {
    const client = await connect()
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS)
    expect(SERVER_INSTRUCTIONS).toContain('https://github.com/pwfabric/packs/releases')
    expect(SERVER_INSTRUCTIONS).toContain('writes every word')
    expect(SERVER_INSTRUCTIONS).toContain('pwf dev')
    expect(client.getServerVersion()).toMatchObject({ name: 'pwfabric', version: '0.0.0-test' })
    // Tools only: nothing a client may lack.
    const caps = client.getServerCapabilities() ?? {}
    expect(Object.keys(caps).filter((k) => k !== 'tools')).toEqual([])

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    expect(tools.map((t) => t.name)).toEqual([
      'pwf_create_app',
      'pwf_create_pack',
      'pwf_add_pack',
      'pwf_add_block',
      'pwf_describe_project',
      'pwf_describe_block',
      'pwf_validate',
      'pwf_build',
      'pwf_pack',
    ])
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40)
      expect(tool.inputSchema.required).toContain('projectDir')
    }
    for (const name of ['pwf_describe_project', 'pwf_describe_block']) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    }
  })

  it('runs create → describe → add block → validate → build → pack on a temporary folder', async () => {
    const client = await connect()
    const root = join(await tempDir(), 'my-shop')

    const created = await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION })
    expect(created.isError).toBeFalsy()
    expect(text(created)).toContain('Created @pwpack/local/my-shop')
    expect(text(created)).toMatch(/\nNext: .*pwf_describe_project/)
    expect(created.structuredContent).toMatchObject({ id: '@pwpack/local/my-shop', version: '0.1.0' })
    expect(existsSync(join(root, 'app', 'surfaces', 'home.receipt.json'))).toBe(true)

    const described = await call(client, 'pwf_describe_project', { projectDir: root })
    expect(described.isError).toBeFalsy()
    expect(described.structuredContent).toMatchObject({ kind: 'app', surfaces: ['home'] })
    const packs = described.structuredContent?.['packs'] as { pack: string; blocks: { type: string }[] }[]
    expect(packs).toHaveLength(1)
    expect(packs[0]?.blocks.length).toBeGreaterThan(0)
    expect(text(described)).toContain('Pages (app/surfaces/): home')

    const block = await call(client, 'pwf_add_block', { projectDir: root, block: 'content/price-tag' })
    expect(block.isError).toBeFalsy()
    expect(block.structuredContent).toMatchObject({ id: 'content.price-tag' })
    expect(text(block)).toContain('atoms/blocks/content/price-tag/manifest.json')
    const again = await call(client, 'pwf_describe_project', { projectDir: root })
    expect(text(again)).toContain('price-tag (content.price-tag)')

    const validated = await call(client, 'pwf_validate', { projectDir: root })
    expect(validated.isError).toBeFalsy()
    expect(validated.structuredContent).toMatchObject({ ok: true, id: '@pwpack/local/my-shop' })
    expect(text(validated)).toContain('Next: call pwf_build')

    const built = await call(client, 'pwf_build', { projectDir: root })
    expect(built.isError, text(built)).toBeFalsy()
    expect(built.structuredContent?.['out']).toBe(join(root, '.pwf', 'out'))
    expect(existsSync(join(root, '.pwf', 'out', 'publish.json'))).toBe(true)
    expect(text(built)).toContain('pwf run')
    expect(built.structuredContent).toMatchObject({ router: 'hash' })
    expect(await readFile(join(root, '.pwf', 'out', 'index.html'), 'utf8')).not.toContain('<base')

    // The same routing inputs as `pwf build --router/--base`.
    const routed = await call(client, 'pwf_build', { projectDir: root, outDir: 'site', router: 'auto', base: '/shop' })
    expect(routed.isError, text(routed)).toBeFalsy()
    expect(routed.structuredContent).toMatchObject({ out: join(root, 'site'), router: 'auto', base: '/shop/' })
    expect(text(routed)).toContain('router: auto, base /shop/')
    const shell = await readFile(join(root, 'site', 'index.html'), 'utf8')
    expect(shell).toContain('<base href="/shop/" />')
    expect(shell).toContain('<meta name="pw-router" content="path" />')
    const badRouter = await call(client, 'pwf_build', { projectDir: root, router: 'history' })
    expect(badRouter.isError).toBe(true)
    const hashBase = await call(client, 'pwf_build', { projectDir: root, base: '/shop/' })
    expect(hashBase.structuredContent).toMatchObject({ error: { code: 'USAGE', message: 'base is for path routing; set router to path (or auto) with it' } })

    const packed = await call(client, 'pwf_pack', { projectDir: root, out: 'dist/shop.pwpack' })
    expect(packed.isError).toBeFalsy()
    expect(packed.structuredContent).toMatchObject({ id: '@pwpack/local/my-shop', file: join(root, 'dist', 'shop.pwpack') })
    expect((packed.structuredContent?.['hash'] as string).startsWith('sha256:')).toBe(true)
    expect(existsSync(join(root, 'dist', 'shop.pwpack'))).toBe(true)
  })

  it('describes one block in full: its pack, props with schema, children and knowledge', async () => {
    const client = await connect()
    const root = join(await tempDir(), 'shop')
    await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION })
    const listed = await call(client, 'pwf_describe_project', { projectDir: root })
    expect(text(listed)).toContain('pwf_describe_block')
    expect(text(listed)).toContain('\nNext: call pwf_describe_block')

    // A block of the folder's own, with a full manifest.
    await call(client, 'pwf_add_block', { projectDir: root, block: 'content/price-tag' })
    const manifestPath = join(root, 'atoms', 'blocks', 'content', 'price-tag', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.knowledge = {
      purpose: 'Shows a price with its currency',
      useCases: ['A product card'],
      composesWith: ['control.button'],
      antiPatterns: ['Long text — use text'],
      implementation: 'Formats with Intl.NumberFormat',
    }
    manifest.definition = {
      props: [
        { name: 'amount', type: 'number', required: true, jsonSchema: { type: 'number', minimum: 0 }, description: 'The price.' },
        { name: 'size', type: '"sm" | "lg"', default: 'sm', jsonSchema: { type: 'string', enum: ['sm', 'lg'] } },
        { name: 'label', type: 'string', copy: true },
      ],
      defaultProps: { amount: 0 },
      canHaveChildren: false,
      traits: ['price'],
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const own = await call(client, 'pwf_describe_block', { projectDir: root, type: 'price-tag' })
    expect(own.isError, text(own)).toBeFalsy()
    expect(own.structuredContent).toMatchObject({
      pack: '@pwpack/local/shop@0.1.0',
      own: true,
      id: 'content.price-tag',
      type: 'price-tag',
      canHaveChildren: false,
      defaultProps: { amount: 0 },
      traits: ['price'],
      knowledge: manifest.knowledge,
    })
    expect(own.structuredContent?.['props']).toEqual(manifest.definition.props)
    const t = text(own)
    expect(t).toContain('price-tag (content.price-tag) from @pwpack/local/shop@0.1.0 (this folder)')
    expect(t).toContain('  - amount (number, required) — The price.')
    expect(t).toContain('      jsonSchema {"type":"number","minimum":0}')
    expect(t).toContain('  - size ("sm" | "lg") default "sm"')
    expect(t).toContain('      jsonSchema {"type":"string","enum":["sm","lg"]}')
    expect(t).toContain('  - label (string, copy)')
    expect(t).toContain('Children: no, it is a leaf')
    expect(t).toContain('  antiPatterns:\n    - Long text — use text')
    expect(t).toContain('  implementation: Formats with Intl.NumberFormat')

    // A block of a pinned pack, by type or by atom id.
    const pinned = await call(client, 'pwf_describe_block', { projectDir: root, type: 'control.button' })
    expect(pinned.isError, text(pinned)).toBeFalsy()
    expect(pinned.structuredContent).toMatchObject({ own: false, id: 'control.button', type: 'button', knowledge: { purpose: 'Test fixture block button' } })
    expect(String(pinned.structuredContent?.['pack'])).toMatch(/^@pwpack\/.+@\d+\.\d+\.\d+$/)
    expect((pinned.structuredContent?.['props'] as { name: string }[]).map((p) => p.name)).toEqual(['label', 'href'])

    // An unknown type: the build's code, with the names it is close to.
    const unknown = await call(client, 'pwf_describe_block', { projectDir: root, type: 'buton' })
    expect(unknown.isError).toBe(true)
    expect(unknown.structuredContent).toMatchObject({ error: { code: 'UNKNOWN_BLOCK_TYPE' } })
    expect(text(unknown)).toContain('did you mean button')
    expect(text(unknown)).toContain('Fix: Pass a type pwf_describe_project lists')
  })

  it('creates a pack and installs another into it', async () => {
    const client = await connect()
    const root = join(await tempDir(), 'cards')
    const created = await call(client, 'pwf_create_pack', { projectDir: root, name: 'cards' })
    expect(created.structuredContent).toMatchObject({ id: '@pwpack/cards', version: '0.1.0' })
    expect(text(created)).toContain('Next: call pwf_add_block')

    const added = await call(client, 'pwf_add_pack', { projectDir: root, pack: K_PACK })
    expect(added.isError, text(added)).toBeFalsy()
    expect(added.structuredContent).toMatchObject({ id: '@pwpack/k/kit', version: '1.0.0', range: '^1.0.0' })
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8'))
    expect(identity.packs[0]).toMatchObject({ id: '@pwpack/k/kit', version: '1.0.0' })

    const described = await call(client, 'pwf_describe_project', { projectDir: root })
    expect(described.structuredContent).toMatchObject({ kind: 'pack' })
    expect(text(described)).toContain('Pinned @pwpack/k/kit@1.0.0')
    expect(text(described)).toContain('theme')

    const withRequirement = await call(client, 'pwf_create_pack', {
      projectDir: join(root, '..', 'more'),
      name: 'more',
      id: '@pwpack/acme/more',
      requires: K_PACK,
    })
    expect(withRequirement.structuredContent).toMatchObject({ id: '@pwpack/acme/more' })
    expect(text(withRequirement)).toContain('Requires @pwpack/k/kit ^1.0.0')
  })

  it('answers failures as tool errors with a code and a fix', async () => {
    const client = await connect()
    const dir = await tempDir()

    const relative = await call(client, 'pwf_validate', { projectDir: 'my-shop' })
    expect(relative.isError).toBe(true)
    expect(text(relative)).toMatch(/^PATH_NOT_ABSOLUTE: /)
    expect(text(relative)).toContain('Fix: Pass projectDir as an absolute path.')

    const notAProject = await call(client, 'pwf_describe_project', { projectDir: dir })
    expect(notAProject.isError).toBe(true)
    expect(notAProject.structuredContent).toMatchObject({ error: { code: 'NOT_A_PROJECT' } })

    const root = join(dir, 'app')
    await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION })
    const notEmpty = await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION })
    expect(notEmpty.structuredContent).toMatchObject({ error: { code: 'FOLDER_NOT_EMPTY' } })
    expect(text(notEmpty)).toContain('force: true')
    const forced = await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION, force: true })
    expect(forced.isError).toBeFalsy()

    const badName = await call(client, 'pwf_create_app', { projectDir: join(dir, 'x'), foundation: FIXTURE_FOUNDATION, name: 'My App' })
    expect(badName.structuredContent).toMatchObject({ error: { code: 'USAGE' } })

    const noFoundation = await call(client, 'pwf_create_app', { projectDir: join(dir, 'y'), foundation: join(dir, 'nothing-here') })
    expect(noFoundation.isError).toBe(true)
    expect(noFoundation.structuredContent).toMatchObject({ error: { code: 'FAILED' } })

    await call(client, 'pwf_create_pack', { projectDir: join(dir, 'empty'), name: 'empty' })
    const notFoundation = await call(client, 'pwf_create_app', { projectDir: join(dir, 'z'), foundation: join(dir, 'empty') })
    expect(notFoundation.structuredContent).toMatchObject({ error: { code: 'FOUNDATION_NO_STARTER_BLOCKS' } })

    const invalidPack = await call(client, 'pwf_add_pack', { projectDir: root, pack: dir })
    expect(invalidPack.structuredContent).toMatchObject({ error: { code: 'PACK_INVALID' } })
    expect(text(invalidPack)).toMatch(/- error \w+/)

    const itself = await call(client, 'pwf_add_pack', { projectDir: root, pack: root })
    expect(itself.structuredContent).toMatchObject({ error: { code: 'PACK_IS_PROJECT' } })

    const outside = await call(client, 'pwf_pack', { projectDir: root, out: '../escape.pwpack' })
    expect(outside.structuredContent).toMatchObject({ error: { code: 'PATH_OUTSIDE_PROJECT' } })
    expect(existsSync(join(dir, 'escape.pwpack'))).toBe(false)
    const outsideBuild = await call(client, 'pwf_build', { projectDir: root, outDir: join(dir, 'site') })
    expect(outsideBuild.structuredContent).toMatchObject({ error: { code: 'PATH_OUTSIDE_PROJECT' } })

    const badBlock = await call(client, 'pwf_add_block', { projectDir: root, block: 'nope' })
    expect(badBlock.structuredContent).toMatchObject({ error: { code: 'USAGE' } })
  })

  it('reports an invalid folder as findings; pack and build refuse theirs', async () => {
    const client = await connect()
    const root = join(await tempDir(), 'demo')
    await call(client, 'pwf_create_app', { projectDir: root, foundation: FIXTURE_FOUNDATION })
    const path = join(root, 'pwpack.json')
    const identity = JSON.parse(await readFile(path, 'utf8'))
    identity.packs[0].hash = `sha256:${'0'.repeat(64)}`
    await writeFile(path, JSON.stringify(identity, null, 2))

    const validated = await call(client, 'pwf_validate', { projectDir: root })
    expect(validated.isError).toBeFalsy()
    expect(validated.structuredContent).toMatchObject({ ok: false })
    expect(text(validated)).toContain('PIN_HASH_MISMATCH')
    expect(text(validated)).toContain('Next: fix each error')

    const packed = await call(client, 'pwf_pack', { projectDir: root })
    expect(packed.isError).toBe(true)
    expect(packed.structuredContent).toMatchObject({ error: { code: 'PROJECT_INVALID' } })

    const receiptPath = join(root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.blocks[0].type = 'no-such-block'
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
    const built = await call(client, 'pwf_build', { projectDir: root })
    expect(built.isError).toBe(true)
    expect(text(built)).toContain('UNKNOWN_BLOCK_TYPE')
    expect(built.structuredContent).toMatchObject({ error: { code: 'BUILD_FAILED' } })
  })

  it('keeps writes inside the project folder and caps long finding lists', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(writeTarget('/a/b', undefined, 'out')).toBeUndefined()
    const many = Array.from({ length: 45 }, (_, i) => ({ severity: 'error' as const, code: `C${i}`, message: 'm' }))
    const capped = failureAnswer(new CommandFailure('PROJECT_INVALID', 'bad', { issues: many }))
    const lines = (capped.content[0]?.text ?? '').split(String.fromCharCode(10))
    expect(lines.filter((l) => l.startsWith('- error'))).toHaveLength(40)
    expect(lines).toContain('- … and 5 more (pwf_validate lists all of them)')
    expect(failureAnswer(new Error('plain')).structuredContent).toMatchObject({ error: { code: 'FAILED', message: 'plain' } })
    expect(failureAnswer('text').structuredContent).toMatchObject({ error: { message: 'text' } })
  })
})
