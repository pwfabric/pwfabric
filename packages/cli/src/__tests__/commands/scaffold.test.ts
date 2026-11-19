/**
 * `pwf create --pack` and `pwf add block`: the skeletons validate, build and
 * pack the same way every time.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { hashPack, readFolder } from '@pwfabric/pack'
import { AtomFileManifestSchema } from '@pwfabric/contracts/schemas'
import { main } from '../../index.js'
import { runCreate } from '../../commands/create.js'
import { add } from '../../commands/add.js'
import { create } from '../../commands/create.js'
import { addBlock, createPack, scaffoldNameProblem } from '../../commands/lib/scaffold.js'
import { capture, FIXTURE_FOUNDATION, schemaErrors, SPEC_SCHEMAS_MISSING, tempDir } from './helpers.js'

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))

/** Every file under `dir`, folder-relative with `/`, sorted. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}${e.name}`
    if (e.isDirectory()) out.push(...(await listFiles(join(dir, e.name), `${rel}/`)))
    else out.push(rel)
  }
  return out.sort()
}

describe('pwf create --pack', () => {
  it('writes an empty canonical pack that validates clean', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['create', '--pack', 'cards'], c.io)).toBe(0)
    const root = join(cwd, 'cards')
    expect(await listFiles(root)).toEqual(['.gitignore', 'README.md', 'atoms/README.md', 'pwpack.json'])
    const identity = await readJson(join(root, 'pwpack.json'))
    expect(Object.keys(identity)).toEqual(['id', 'version', 'formatVersion', 'engines', 'requires'])
    expect(identity).toMatchObject({ id: '@pwpack/cards', version: '0.1.0', formatVersion: '1.1', requires: [] })
    expect(identity.engines.pwfabric).toMatch(/^>=\d+\.\d+ <\d+$/)
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.pwf/\n*.pwpack\n')
    const readme = await readFile(join(root, 'README.md'), 'utf8')
    expect(readme).toContain('pwf add block <category>/<type>')
    expect(readme).toContain('pwf validate')
    expect(readme).toContain('pwf pack')
    expect(c.out[0]).toBe(`Created @pwpack/cards in ${root}`)
    expect(c.out).toContain('  cd cards')

    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(0)
    expect(v.out.at(-1)).toBe('@pwpack/cards@0.1.0: valid (0 errors, 0 warnings; layout canonical; 0 atoms)')
  })

  it.skipIf(SPEC_SCHEMAS_MISSING !== undefined)(
    `writes a pwpack.json that satisfies the spec schema${SPEC_SCHEMAS_MISSING ? ` (skipped: ${SPEC_SCHEMAS_MISSING})` : ''}`,
    async () => {
      const cwd = await tempDir()
      expect(await main(['create', '--pack', 'cards'], capture(cwd).io)).toBe(0)
      expect(schemaErrors('pwpack-format', await readJson(join(cwd, 'cards', 'pwpack.json')))).toEqual([])
    }
  )

  it('takes the name after --pack or before it, --id and --dir', async () => {
    const cwd = await tempDir()
    expect(await main(['create', 'cards', '--pack', '--dir', 'nested/one'], capture(cwd).io)).toBe(0)
    expect((await readJson(join(cwd, 'nested', 'one', 'pwpack.json'))).id).toBe('@pwpack/cards')
    expect(await main(['create', '--pack', 'cards', '--id', '@pwpack/acme/cards', '--dir', 'two'], capture(cwd).io)).toBe(0)
    expect((await readJson(join(cwd, 'two', 'pwpack.json'))).id).toBe('@pwpack/acme/cards')
  })

  it('declares the engine major it is given', async () => {
    const cwd = await tempDir()
    expect(await runCreate({ positionals: [], flags: { pack: 'cards' } }, capture(cwd).io, { engineVersion: '3.4.1' })).toBe(0)
    expect((await readJson(join(cwd, 'cards', 'pwpack.json'))).engines).toEqual({ pwfabric: '>=3.4 <4' })
  })

  it('stands on the pack --requires names: cached, pinned and required', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['create', '--pack', 'cards', '--requires', FIXTURE_FOUNDATION], c.io)).toBe(0)
    const root = join(cwd, 'cards')
    const identity = await readJson(join(root, 'pwpack.json'))
    const hash = hashPack(await readFolder(FIXTURE_FOUNDATION))
    expect(identity.requires).toEqual([{ id: '@pwpack/fixture/foundation', range: '^1.0.0' }])
    expect(identity.packs).toEqual([{ id: '@pwpack/fixture/foundation', version: '1.2.0', hash }])
    const cached = await readFolder(join(root, '.pwf', 'packs', '@pwpack', 'fixture', 'foundation@1.2.0'))
    expect(hashPack(cached)).toBe(hash)
    expect(c.out.join('\n')).toContain(`requires  @pwpack/fixture/foundation ^1.0.0 (${hash})`)
    expect(await main(['validate', root], capture(cwd).io)).toBe(0)
  })

  it('refuses a bad name, a bad --id, --foundation and a folder that is not empty', async () => {
    const cwd = await tempDir()
    for (const argv of [
      ['create', '--pack'],
      ['create', '--pack', 'Cards'],
      ['create', '--pack', '9cards'],
      ['create', '--pack', 'c'],
      ['create', '--pack', 'cards', 'extra'],
      ['create', '--pack', 'cards', '--foundation', FIXTURE_FOUNDATION],
      ['create', '--pack', 'cards', '--id', ''],
      ['create', '--pack', 'cards', '--id', 'no spaces/allowed'],
    ]) {
      const c = capture(cwd)
      expect(await main(argv, c.io), argv.join(' ')).toBe(2)
    }
    expect(existsSync(join(cwd, 'cards'))).toBe(false)

    await mkdir(join(cwd, 'cards'))
    await writeFile(join(cwd, 'cards', 'keep.txt'), 'x')
    const c = capture(cwd)
    expect(await main(['create', '--pack', 'cards'], c.io)).toBe(1)
    expect(c.err[0]).toContain('is not empty')
    expect(await main(['create', '--pack', 'cards', '--force'], capture(cwd).io)).toBe(0)
    expect(existsSync(join(cwd, 'cards', 'keep.txt'))).toBe(true)
  })

  it('refuses a --requires that is not a valid pack', async () => {
    const cwd = await tempDir()
    await mkdir(join(cwd, 'broken'))
    const c = capture(cwd)
    expect(await main(['create', '--pack', 'cards', '--requires', 'broken'], c.io)).toBe(1)
    expect(c.err[0]).toContain('is not a valid pack')
    expect(existsSync(join(cwd, 'cards'))).toBe(false)
  })
})

describe('pwf add block', () => {
  async function pack(): Promise<string> {
    const cwd = await tempDir()
    expect(await main(['create', '--pack', 'cards'], capture(cwd).io)).toBe(0)
    return join(cwd, 'cards')
  }

  it('writes a block manifest and component that validate clean', async () => {
    const root = await pack()
    const c = capture(root)
    expect(await main(['add', 'block', 'content/price-tag'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Added block content.price-tag')
    const dir = join(root, 'atoms', 'blocks', 'content', 'price-tag')
    expect(await listFiles(dir)).toEqual(['component.tsx', 'manifest.json'])
    const manifest = await readJson(join(dir, 'manifest.json'))
    expect(manifest).toMatchObject({
      id: 'content.price-tag',
      kind: 'block',
      category: 'content',
      name: 'price-tag',
      definition: { props: [], defaultProps: {}, canHaveChildren: false },
    })
    expect(AtomFileManifestSchema.safeParse(manifest).success).toBe(true)

    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(0)
    expect(v.out.at(-1)).toBe('@pwpack/cards@0.1.0: valid (0 errors, 0 warnings; layout canonical; 1 atoms)')
  })

  it.skipIf(SPEC_SCHEMAS_MISSING !== undefined)(
    `writes a manifest that satisfies the spec schema${SPEC_SCHEMAS_MISSING ? ` (skipped: ${SPEC_SCHEMAS_MISSING})` : ''}`,
    async () => {
      const root = await pack()
      expect(await main(['add', 'block', 'content/price-tag'], capture(root).io)).toBe(0)
      const manifest = await readJson(join(root, 'atoms', 'blocks', 'content', 'price-tag', 'manifest.json'))
      expect(schemaErrors('block-manifest', manifest)).toEqual([])
    }
  )

  it('writes a component with no words of its own', async () => {
    const root = await pack()
    await main(['add', 'block', 'content/price-tag'], capture(root).io)
    const source = await readFile(join(root, 'atoms', 'blocks', 'content', 'price-tag', 'component.tsx'), 'utf8')
    expect(source).toContain('export default function PriceTagBlock(')
    // JSX text between tags, and string literals other than imports and the type marker.
    expect(source).not.toMatch(/>[^<>{}\n]*[A-Za-z][^<>{}\n]*</)
    const literals = [...source.matchAll(/(['"])([^'"\n]*)\1/g)].map((m) => m[2])
    expect(literals.filter((l) => !['react', '@pwfabric/contracts', 'price-tag'].includes(l as string))).toEqual([])
    expect(source).not.toContain('zod')
  })

  it('compiles in pwf build once an app places it', async () => {
    const cwd = await tempDir()
    expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
    const root = join(cwd, 'demo')
    expect(await main(['add', 'block', 'content/price-tag', '--dir', root], capture(cwd).io)).toBe(0)
    const receiptPath = join(root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = await readJson(receiptPath)
    receipt.blocks.push({ id: 'price', type: 'price-tag', props: {} })
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

    expect(await main(['validate', root], capture(cwd).io)).toBe(0)
    const b = capture(root)
    expect(await main(['build'], b.io)).toBe(0)
    expect(b.out.join('\n')).not.toContain('failed')
    const blocks = await readdir(join(root, '.pwf', 'out', 'blocks'), { recursive: true })
    expect(blocks.some((f) => String(f).includes('price-tag'))).toBe(true)
  })

  it('refuses an existing type, a type another category has, and bad names', async () => {
    const root = await pack()
    expect(await main(['add', 'block', 'content/price-tag'], capture(root).io)).toBe(0)
    const again = capture(root)
    expect(await main(['add', 'block', 'content/price-tag'], again.io)).toBe(1)
    expect(again.err[0]).toContain('already exists')
    const other = capture(root)
    expect(await main(['add', 'block', 'data/price-tag'], other.io)).toBe(1)
    expect(other.err[0]).toContain('content.price-tag already answers to "price-tag"')

    for (const spec of ['price-tag', 'content/Price', 'content/price_tag', 'a/b/c', 'content/9x', 'content/x', 'content/a--b', '']) {
      expect(await main(['add', 'block', spec], capture(root).io), spec).toBe(2)
    }
    expect(await main(['add', 'block'], capture(root).io)).toBe(2)
    expect(await main(['add', 'block', 'content/a-b', 'extra'], capture(root).io)).toBe(2)
    expect(existsSync(join(root, 'atoms', 'blocks', 'data'))).toBe(false)
  })

  it('refuses a folder without pwpack.json', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['add', 'block', 'content/price-tag'], c.io)).toBe(1)
    expect(c.err[0]).toContain('pwpack.json not found')
  })

  it('still adds a pack folder named block, given as ./block', async () => {
    const cwd = await tempDir()
    expect(await main(['create', '--pack', 'block'], capture(cwd).io)).toBe(0)
    expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
    const c = capture(join(cwd, 'demo'))
    expect(await main(['add', '../block'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Added @pwpack/block@0.1.0')
  })
})

describe('scaffolding is deterministic', () => {
  it('the same commands give the same files and the same pack hash', async () => {
    const hashes: string[] = []
    const texts: string[] = []
    for (let i = 0; i < 2; i++) {
      const cwd = await tempDir()
      const root = join(cwd, 'cards')
      await createPack({ name: 'cards', dir: root, engineVersion: '3.0.1' })
      await addBlock({ root, block: 'content/price-tag' })
      const p = capture(root)
      expect(await main(['pack', '--out', join(cwd, 'cards.pwpack')], p.io)).toBe(0)
      hashes.push(p.out.find((l) => l.startsWith('  hash')) as string)
      const files = await listFiles(root)
      texts.push(JSON.stringify(await Promise.all(files.map(async (f) => [f, await readFile(join(root, ...f.split('/')), 'utf8')]))))
    }
    expect(hashes[0]).toBe(hashes[1])
    expect(texts[0]).toBe(texts[1])
    expect(texts[0]).not.toContain('\\r')
  })

  it('names the grammar it refuses', () => {
    expect(scaffoldNameProblem('price-tag')).toBeUndefined()
    expect(scaffoldNameProblem('x')).toContain('2–50')
    expect(scaffoldNameProblem('Price')).toContain('lower-case')
  })

  it('describes both forms in the usage', () => {
    expect(create.usage).toContain('pwf create --pack <name>')
    expect(add.usage).toContain('pwf add block <category>/<type>')
  })
})

describe('@pwfabric/cli/authoring', () => {
  const pkgDir = fileURLToPath(new URL('../../../', import.meta.url))

  it('is an export of the package with the authoring functions', async () => {
    const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as { exports: Record<string, unknown> }
    expect(pkg.exports['./authoring']).toEqual({
      types: './dist/authoring.d.ts',
      import: './dist/authoring.js',
      default: './dist/authoring.js',
    })
    const entry = await import('../../authoring.js')
    expect(Object.keys(entry).sort()).toEqual([
      'PACK_ID',
      'UsageError',
      'addBlock',
      'blockComponent',
      'blockManifest',
      'createPack',
      'readProject',
      'scaffoldNameProblem',
    ])
  })

  it('bundles without the dev server, the compiler or the runner', async () => {
    const result = await build({
      entryPoints: [join(pkgDir, 'src', 'authoring.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    const inputs = Object.keys(result.metafile.inputs).map((p) => p.replace(/\\/g, '/'))
    const heavy = inputs.filter((p) => /\/(compiler|runner|runtime|embed|esbuild)\/|\/src\/dev\/|\/src\/host\//.test(p))
    expect(heavy).toEqual([])
  })
})
