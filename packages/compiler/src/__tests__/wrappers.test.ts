/**
 * Hostile names. Pack folder and file names reach the generated wrapper source;
 * a name must never become code. Each hostile name is refused by `compileAtom`
 * with INVALID_INPUT (not a throw), refused by `buildWrapperSource`, and never
 * appears in anything the compiler emits.
 */
import { describe, it, expect } from 'vitest'
import { compileAtom } from '../compile.js'
import { buildWrapperSource, isValidEngineName, isValidSourceBase } from '../wrappers.js'

const HOSTILE = [
  "x'; globalThis.pwned = 1; //",
  'x"; globalThis.pwned = 1; //',
  'x`; globalThis.pwned = 1; //',
  "'; alert(1); //",
  '../x',
  '..',
  'x\nglobalThis.pwned = 1',
  'x\r\nalert(1)',
  'x${alert(1)}',
  'a b',
  '',
]

describe('wrapper names — validation', () => {
  it('plain names pass', () => {
    expect(isValidEngineName('Acme_Engine-2')).toBe(true)
    expect(isValidSourceBase('component')).toBe(true)
    expect(isValidSourceBase('component.client')).toBe(true)
  })

  for (const name of HOSTILE) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      expect(isValidEngineName(name)).toBe(false)
      expect(isValidSourceBase(name)).toBe(false)
      expect(() => buildWrapperSource('connector', { engineName: name })).toThrow(/invalid engine name/)
      expect(() => buildWrapperSource('provider', { engineName: name })).toThrow(/invalid engine name/)
      expect(() => buildWrapperSource('block', { sourceBase: name })).toThrow(/invalid entry basename/)
      expect(() => buildWrapperSource('capability', { sourceBase: name })).toThrow(/invalid entry basename/)
    })
  }

  it('emits every name-derived specifier and key through JSON string literals', () => {
    expect(buildWrapperSource('block', { sourceBase: 'component' })).toContain('from "./component.js"')
    expect(buildWrapperSource('capability', { sourceBase: 'handler' })).toBe('export * from "./handler.js"\n')
    expect(buildWrapperSource('connector', { engineName: 'Acme' })).toContain('from "./Acme"')
    const provider = buildWrapperSource('provider', { engineName: 'orders' })
    expect(provider).toContain('from "./orders"')
    expect(provider).toContain('m["orders"]')
    expect(provider).not.toMatch(/'\.\/orders'|\['orders'\]/)
  })
})

describe('wrapper names — compileAtom refuses, never throws, never emits', () => {
  for (const name of HOSTILE.filter((n) => n !== '' && !n.includes('/') && n !== '..')) {
    it(`block entry basename ${JSON.stringify(name)} → INVALID_INPUT`, async () => {
      const entry = `blocks/a/b/${name}.tsx`
      const r = await compileAtom({ files: { [entry]: 'export const x = 1' }, entry })
      expect(r.ok).toBe(false)
      expect(r.diagnostics.map((d) => d.code)).toEqual(['INVALID_INPUT'])
      expect(r.code).toBe('')
      expect(r.code).not.toContain('pwned')
    })
  }

  for (const name of HOSTILE.filter((n) => n !== '')) {
    it(`connector engineName ${JSON.stringify(name)} → INVALID_INPUT`, async () => {
      const r = await compileAtom({
        files: { 'connectors/Acme.ts': 'export const nothing = 1' },
        entry: 'connectors/Acme.__engine__.ts',
        kind: 'connector',
        engineName: name,
      })
      expect(r.ok).toBe(false)
      expect(r.diagnostics.map((d) => d.code)).toEqual(['INVALID_INPUT'])
      expect(r.code).toBe('')
    })

    it(`provider engineName ${JSON.stringify(name)} → INVALID_INPUT`, async () => {
      const r = await compileAtom({
        files: { 'providers/v/index.ts': 'export {}' },
        entry: 'providers/v/entities/x.__engine__.ts',
        kind: 'provider',
        engineName: name,
      })
      expect(r.diagnostics.map((d) => d.code)).toEqual(['INVALID_INPUT'])
    })
  }
})

describe('block wrapper — which export is the component', () => {
  /** Runs the generated block wrapper against `atom` as the entry module's namespace. */
  async function resolve(atom: Record<string, unknown>): Promise<{ Component: unknown; definition: unknown }> {
    const source = buildWrapperSource('block', { sourceBase: 'component' }).replace(
      'import * as _atom from "./component.js"',
      'const _atom = globalThis.__pwfabric_wrapper_atom'
    )
    const g = globalThis as Record<string, unknown>
    g['__pwfabric_wrapper_atom'] = atom
    try {
      const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
      return (await import(/* @vite-ignore */ url)) as { Component: unknown; definition: unknown }
    } finally {
      delete g['__pwfabric_wrapper_atom']
    }
  }

  it('takes the component from a defineBlock() definition when the module exports only that', async () => {
    const component = (): null => null
    const definition = Object.freeze({ type: 'quote-card', schema: {}, component })
    const m = await resolve({ QuoteCard: definition })
    expect(m.Component).toBe(component)
    expect(m.definition).toBe(definition)
  })

  it('still prefers a default-exported component', async () => {
    const own = (): null => null
    const m = await resolve({ default: own, QuoteCard: { type: 'q', schema: {}, component: (): null => null } })
    expect(m.Component).toBe(own)
  })

  it('still finds a plain named component with no definition', async () => {
    const GreetingBlock = (): null => null
    expect((await resolve({ GreetingBlock })).Component).toBe(GreetingBlock)
  })
})
