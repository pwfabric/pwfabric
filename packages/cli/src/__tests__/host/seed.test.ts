import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSeed } from '../../host/definitions.js'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function app(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'pwf-seed-'))
  roots.push(root)
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body))
  }
  return root
}

const A = '0b7d1c56-3f7e-4a52-9a0c-1f2e3d4c5b6a'
const B = '6a5b4c3d-2e1f-4c0a-9b8a-7f6e5d4c3b2a'

describe('readSeed — app/content then app/data', () => {
  it('loads the shipped content when there is no development data', () => {
    const root = app({ 'app/content/Product.json': { data: [{ id: A, name: 'Tea' }, { id: B, name: 'Coffee' }] } })
    expect(readSeed(root, 'Product').map((r) => r['name'])).toEqual(['Tea', 'Coffee'])
  })

  it('adds development rows after the content, and a data row with a content id replaces it', () => {
    const root = app({
      'app/content/Product.json': { data: [{ id: A, name: 'Tea' }, { id: B, name: 'Coffee' }] },
      'app/data/Product.json': { data: [{ id: B, name: 'Coffee (test)' }, { name: 'Draft' }, { name: 'Draft 2' }] },
    })
    expect(readSeed(root, 'Product').map((r) => r['name'])).toEqual(['Tea', 'Coffee (test)', 'Draft', 'Draft 2'])
  })

  it('rejects a content file that is not { data: [...] }', () => {
    const root = app({ 'app/content/Product.json': [{ id: A }] })
    expect(() => readSeed(root, 'Product')).toThrow('{ "data": [ ...records ] }')
  })
})
