/**
 * A runtime subpath on the block host-import list is served by the ROOT shim
 * (`runtime.mjs`, re-exporting `globalThis.__pwfabric_runtime`, which the host
 * seeds from this package's root). That is only correct when the root exports
 * every name the subpath does, as the same value. This checks it for every
 * runtime subpath the list carries, so a subpath that stops being re-exported
 * fails here instead of as an undefined import inside a published block.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BLOCK_HOST_IMPORTS } from '@pwfabric/core'

const ROOT = '@pwfabric/runtime'

interface PackageJson {
  readonly exports: Record<string, { readonly import: string }>
}
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
) as PackageJson

/** `./dist/data/index.js` → the source module vitest can load. */
function sourceOf(subpath: string): string {
  const entry = pkg.exports[`./${subpath}`]
  if (!entry) throw new Error(`runtime package exports no './${subpath}'`)
  return new URL(`../../${entry.import.replace(/^\.\/dist\//, 'src/')}`, import.meta.url).href
}

const subpaths = BLOCK_HOST_IMPORTS.filter((i) => i.specifier.startsWith(`${ROOT}/`)).map((i) =>
  i.specifier.slice(ROOT.length + 1)
)

describe('runtime subpaths on the block host-import list', () => {
  it('lists at least the data subpath the foundation pack imports', () => {
    expect(subpaths).toContain('data')
  })

  it.each(subpaths)("'%s' is an exact export of the package, re-exported wholesale by the root", async (sub) => {
    const root = (await import('../index.js')) as Record<string, unknown>
    const mod = (await import(/* @vite-ignore */ sourceOf(sub))) as Record<string, unknown>
    const names = Object.keys(mod)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(name in root, `${ROOT}/${sub} exports '${name}' but the root does not`).toBe(true)
      expect(root[name], `${ROOT}/${sub}.${name}`).toBe(mod[name])
    }
  }, 60_000)
})
