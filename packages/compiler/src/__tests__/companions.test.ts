import { describe, it, expect } from 'vitest'
import { collectCompanions, isCompanionTarget, resolveCompanion } from '../companions.js'
import { compileAtom } from '../compile.js'
import { LIB_BLOCK } from './fixtures.js'

describe('isCompanionTarget', () => {
  it('admits lib code (both layouts) and _shared-* files, nothing else', () => {
    expect(isCompanionTarget('lib/x.ts')).toBe(true)
    expect(isCompanionTarget('atoms/lib/x.ts')).toBe(true)
    expect(isCompanionTarget('blocks/a/b/_shared-copy.ts')).toBe(true)
    expect(isCompanionTarget('blocks/a/other/component.tsx')).toBe(false)
    expect(isCompanionTarget('library/x.ts')).toBe(false)
  })
})

describe('resolveCompanion', () => {
  const files = new Set(['atoms/lib/a.ts', 'atoms/lib/b.tsx', 'atoms/lib/data.json', 'atoms/lib/dir/index.ts', 'atoms/blocks/x/other.ts'])
  const from = 'atoms/blocks/x/component.tsx'
  it('resolves .js spellings, extensionless, json and index files', () => {
    expect(resolveCompanion(from, '../../lib/a.js', files)).toBe('atoms/lib/a.ts')
    expect(resolveCompanion(from, '../../lib/b', files)).toBe('atoms/lib/b.tsx')
    expect(resolveCompanion(from, '../../lib/data', files)).toBe('atoms/lib/data.json')
    expect(resolveCompanion(from, '../../lib/dir', files)).toBe('atoms/lib/dir/index.ts')
  })
  it('returns null for a non-companion, a missing file, or a climb out of the tree', () => {
    expect(resolveCompanion(from, './other', files)).toBeNull()
    expect(resolveCompanion(from, '../../lib/missing', files)).toBeNull()
    expect(resolveCompanion(from, '../../../../lib/a', files)).toBeNull()
  })
})

describe('collectCompanions', () => {
  it('finds the companions a fixture reaches, and they compile as declared', async () => {
    const scan = collectCompanions(LIB_BLOCK.files, LIB_BLOCK.entry)
    expect(scan.ok, scan.violations.join(' | ')).toBe(true)
    expect([...scan.companions].sort()).toEqual([...LIB_BLOCK.companions].sort())
    const r = await compileAtom({ files: LIB_BLOCK.files, entry: LIB_BLOCK.entry, companions: scan.companions })
    expect(r.ok).toBe(true)
  })

  it('follows companions transitively and screens each, prefixing its path', () => {
    const scan = collectCompanions(
      {
        'blocks/a/b/component.tsx': "import { f } from '../../../lib/one'\nexport const c = f",
        'lib/one.ts': "import { g } from './two'\nimport cfg from './cfg.json'\nexport const f = () => g + cfg.k",
        'lib/two.ts': 'export const g = fetch(1)',
        'lib/cfg.json': '{"k": 1}',
      },
      'blocks/a/b/component.tsx'
    )
    expect(scan.ok).toBe(false)
    expect(scan.companions).toEqual(['lib/one.ts', 'lib/two.ts', 'lib/cfg.json'])
    expect(scan.violations).toHaveLength(1)
    expect(scan.violations[0]).toMatch(/^lib\/two\.ts: line 1: fetch\(\)/)
  })

  it('rejects a relative import that is not a companion target', () => {
    const scan = collectCompanions(
      {
        'blocks/a/b/component.tsx': "import { x } from '../other/component'\nexport const c = x",
        'blocks/a/other/component.tsx': 'export const x = 1',
      },
      'blocks/a/b/component.tsx'
    )
    expect(scan.ok).toBe(false)
    expect(scan.violations[0]).toContain('relative import')
    expect(scan.companions).toEqual([])
  })

  it('visits a companion reached twice only once (cycles terminate)', () => {
    const scan = collectCompanions(
      {
        'blocks/a/b/component.tsx': "import { a } from '../../../lib/a'\nimport { b } from '../../../lib/b'\nexport const c = a + b",
        'lib/a.ts': "import { b } from './b'\nexport const a = b",
        'lib/b.ts': "import { a } from './a'\nexport const b = 1",
      },
      'blocks/a/b/component.tsx'
    )
    expect(scan.ok).toBe(true)
    expect(scan.companions).toEqual(['lib/a.ts', 'lib/b.ts'])
  })

  it('accepts byte contents and reports a missing entry', () => {
    const bytes = new TextEncoder().encode('export const x = 1')
    expect(collectCompanions({ 'blocks/a/b/component.tsx': bytes }, 'blocks/a/b/component.tsx').ok).toBe(true)
    const missing = collectCompanions({}, 'blocks/a/b/component.tsx')
    expect(missing.ok).toBe(false)
    expect(missing.violations[0]).toContain('not in the source tree')
  })

  it('takes an injected screen', () => {
    const scan = collectCompanions({ 'e.ts': 'export {}' }, 'e.ts', () => ({ ok: false, violations: ['nope'] }))
    expect(scan.violations).toEqual(['nope'])
  })
})
