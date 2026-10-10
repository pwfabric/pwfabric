/**
 * classifyAtom — the rule that decides what a file in a pwpack becomes.
 *
 * WHAT THESE LOCK. The function moved here from a module-private slot in
 * the platform, so the side that must satisfy it — the pack authors
 * — can import it. Two properties matter and they fail differently:
 *
 *   - The PATH conventions. Getting one wrong makes a file inert: it travels
 *     inside the tgz, never enters `manifest.atoms[]`, and nothing anywhere
 *     errors. That is not hypothetical — it is exactly how the `ui-appearance`
 *     convention shipped unclassified for months.
 *   - The ID derivation. Getting one wrong is worse than inert: the atom IS
 *     recorded, under a name no consumer can resolve.
 *
 * So every case below asserts BOTH, and the reachability test ties the whole
 * thing to `ATOM_KIND_META` — the reason `pathConvention` stops being prose.
 *
 * @module @pwfabric/contracts/__tests__/atom-classify
 */

import { describe, it, expect } from 'vitest'
import { ATOM_KINDS, ATOM_KIND_META, classifyAtom, identityMethodOfAtomId } from '../fabric/atom.js'
import { IDENTITY_METHODS } from '../fabric/project-identity.js'
import type { AtomKind } from '../fabric/atom.js'

/**
 * One recognised path per declared kind. Deliberately a hand-written map and
 * NOT derived from `pathConvention`: deriving it would make the reachability
 * test compare the conventions to themselves and pass on any pair of matching
 * mistakes.
 */
const SAMPLE_PATH: Record<AtomKind, string> = {
  block: 'blocks/marketing/hero/component.tsx',
  surface: 'surfaces/landing.receipt.json',
  capability: 'capabilities/persistence/handler.ts',
  'ui-appearance': 'appearance/default/manifest.json',
  pattern: 'patterns/two-column.json',
  'icon-set': 'icons/icons.json',
  connector: 'connectors/Sharepoint.knowledge.json',
  provider: 'providers/microsoft/entities/mail.knowledge.json',
  'auth-provider': 'auth/AuthProvider.knowledge.json',
}

describe('classifyAtom — every declared kind is reachable', () => {
  it.each(ATOM_KINDS)('%s has a path the classifier recognises', (kind) => {
    // THE POINT OF THIS TEST. A kind added to ATOM_KIND_META with no classifier
    // rule fails here, in the same package, the moment the kind is added.
    const result = classifyAtom(SAMPLE_PATH[kind])
    expect(result, `no sample path classifies as '${kind}'`).not.toBeNull()
    expect(result?.kind).toBe(kind)
  })

  it('has a sample for exactly the declared kinds — no more, no fewer', () => {
    expect(Object.keys(SAMPLE_PATH).sort()).toEqual([...ATOM_KINDS].sort())
  })

  it('every declared kind states a pathConvention', () => {
    // The prose stays (it is what a human reads off the meta), but it may not
    // be blank while the executable rule exists beside it.
    for (const kind of ATOM_KINDS) {
      expect(ATOM_KIND_META[kind].pathConvention.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('classifyAtom — id derivation', () => {
  it('nests a block id from its directory path', () => {
    expect(classifyAtom('blocks/marketing/hero/component.tsx')).toEqual({
      kind: 'block',
      id: 'marketing.hero',
    })
  })

  it('gives a precompiled block THE SAME id as its source form', () => {
    // A re-hosted block arrives as an already-bundled ESM module with no source.
    // A different id here would install the same block twice under two names.
    const fromSource = classifyAtom('blocks/marketing/hero/component.tsx')
    const fromBundle = classifyAtom('blocks/marketing/hero/bundle.mjs')
    expect(fromBundle).toEqual(fromSource)
  })

  it('folds a surface receipt path and its leaf into one dotted id', () => {
    expect(classifyAtom('surfaces/marketing/landing.receipt.json')).toEqual({
      kind: 'surface',
      id: 'marketing.landing',
    })
  })

  it('namespaces a capability under platform/', () => {
    expect(classifyAtom('capabilities/persistence/handler.ts')).toEqual({
      kind: 'capability',
      id: 'platform/persistence',
    })
  })

  it('derives a provider id from vendor AND entity', () => {
    // Two vendors may ship an entity of the same name; the vendor prefix is
    // what keeps them from colliding into one row.
    expect(classifyAtom('providers/microsoft/entities/mail.knowledge.json')).toEqual({
      kind: 'provider',
      id: 'microsoft.mail',
    })
  })

  it('gives both auth-provider forms the same id', () => {
    // The knowledge file and the source file are ONE atom. Different ids would
    // make a pack that ships both install it twice.
    expect(classifyAtom('auth/AuthProvider.knowledge.json')).toEqual({
      kind: 'auth-provider',
      id: 'auth',
    })
    expect(classifyAtom('auth/AuthProvider.tsx')).toEqual({ kind: 'auth-provider', id: 'auth' })
  })

  it('sorts the auth knowledge file BEFORE the source file', () => {
    // Not a property of this function, but the property the CALLER depends on:
    // a sorted walk must reach `.knowledge.json` first so it wins the atomMap
    // dedup. If this ever flips, the lean source-only row silently wins and the
    // knowledge payload is dropped.
    expect(['auth/AuthProvider.tsx', 'auth/AuthProvider.knowledge.json'].sort()).toEqual([
      'auth/AuthProvider.knowledge.json',
      'auth/AuthProvider.tsx',
    ])
  })
})

describe('classifyAtom — one auth-provider atom per identity method', () => {
  it.each(IDENTITY_METHODS.map((m) => [m]))(
    'auth/%s.knowledge.json is the method atom auth.<method>',
    (method) => {
      // Every method in the closed list is reachable — a method added to
      // IDENTITY_METHODS becomes shippable as an atom with no change here.
      expect(classifyAtom(`auth/${method}.knowledge.json`)).toEqual({
        kind: 'auth-provider',
        id: `auth.${method}`,
      })
    }
  )

  it('a method the platform does not implement is inert cargo, not a door', () => {
    // A row called `auth.bogus` would be offered to an app builder as a way in
    // that nobody can open.
    expect(classifyAtom('auth/bogus.knowledge.json')).toBeNull()
    // Case is part of the name: the list is lower-case values, not labels.
    expect(classifyAtom('auth/Password.knowledge.json')).toBeNull()
  })

  it('only the knowledge file is the method atom — its source is not a second one', () => {
    expect(classifyAtom('auth/password.tsx')).toBeNull()
    expect(classifyAtom('auth/microsoft.ts')).toBeNull()
  })

  it('a method file must sit directly under auth/', () => {
    expect(classifyAtom('auth/methods/password.knowledge.json')).toBeNull()
  })

  it('the runtime keeps its id — the method rule does not swallow AuthProvider', () => {
    expect(classifyAtom('auth/AuthProvider.knowledge.json')).toEqual({
      kind: 'auth-provider',
      id: 'auth',
    })
    expect(classifyAtom('auth/AuthProvider.tsx')).toEqual({ kind: 'auth-provider', id: 'auth' })
  })

  it('the documented convention names both forms', () => {
    const convention = ATOM_KIND_META['auth-provider'].pathConvention
    expect(convention).toContain('auth/AuthProvider')
    expect(convention).toContain('auth/<method>.knowledge.json')
  })
})

describe('identityMethodOfAtomId — the inverse of the method rule', () => {
  it('reads the method back out of a method atom id', () => {
    expect(identityMethodOfAtomId('auth.password')).toBe('password')
    expect(identityMethodOfAtomId('auth.microsoft')).toBe('microsoft')
  })

  it('the runtime atom is not a method', () => {
    expect(identityMethodOfAtomId('auth')).toBeNull()
  })

  it('a name outside the closed list is not a method', () => {
    expect(identityMethodOfAtomId('auth.bogus')).toBeNull()
    expect(identityMethodOfAtomId('auth.')).toBeNull()
    expect(identityMethodOfAtomId('password')).toBeNull()
    expect(identityMethodOfAtomId('connector.password')).toBeNull()
  })

  it('round-trips with classifyAtom for every method', () => {
    // The pair is the point: whatever id the classifier writes, the reader
    // must map back to the method the file was named after.
    for (const method of IDENTITY_METHODS) {
      const c = classifyAtom(`auth/${method}.knowledge.json`)
      expect(c && identityMethodOfAtomId(c.id)).toBe(method)
    }
  })
})

describe('classifyAtom — what is NOT an atom', () => {
  it.each([
    ['connectors/Sharepoint.ts', 'a connector ENGINE — compiled at publish from the knowledge sibling'],
    ['providers/microsoft/index.ts', 'a shared vendor motor, not an atom of its own'],
    ['README.md', 'documentation'],
    ['patterns/nested/two-column.json', 'patterns are flat — a nested one is not the convention'],
    ['surfaces/landing.json', 'a surface without the .receipt.json marker'],
    ['blocks/component.tsx', 'no block directory at all'],
  ])('%s is inert cargo (%s)', (path) => {
    expect(classifyAtom(path)).toBeNull()
  })

  it('a single-segment block directory DOES classify, un-namespaced', () => {
    // Measured, not assumed: the rule is `parts.length >= 3`, so one directory
    // is enough and the id carries no namespace. Written down because it reads
    // like an edge case and is in fact the supported flat form.
    expect(classifyAtom('blocks/hero/component.tsx')).toEqual({ kind: 'block', id: 'hero' })
  })

  it('MEASURED QUIRK: any depth under icons/ classifies, and always as the same id', () => {
    // The icon rule checks only `parts[0] === 'icons'` and the filename, with no
    // depth constraint and a hard-coded id. So a pack shipping two nested icon
    // sets produces TWO atoms with the id 'icons' — the second silently wins the
    // atomMap dedup.
    //
    // This is carried over unchanged on purpose: authorised a MOVE, and
    // narrowing the rule here would change which files classify, in a repo whose
    // corpus nobody has re-measured yet. It is asserted rather than left
    // undiscovered — making exactly this kind of thing visible from the packs
    // side is why the function moved. Fixing it is a separate decision.
    expect(classifyAtom('icons/icons.json')).toEqual({ kind: 'icon-set', id: 'icons' })
    expect(classifyAtom('icons/set-a/icons.json')).toEqual({ kind: 'icon-set', id: 'icons' })
    expect(classifyAtom('icons/set-b/icons.json')).toEqual({ kind: 'icon-set', id: 'icons' })
  })

  it('returns null rather than throwing on junk', () => {
    // It runs over every path in a pack, including ones nobody predicted.
    for (const junk of ['', '/', '///', 'blocks', 'blocks/', '.']) {
      expect(() => classifyAtom(junk)).not.toThrow()
    }
  })
})
