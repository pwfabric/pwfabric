/**
 * Atom manifest schema tests
 *
 * Covers the previously-untested `fabric/atom.ts` Zod schemas:
 * `AtomManifestKnowledgeSchema`, `AtomBlockDefinitionMetadataSchema`,
 * and the composed `AtomFileManifestSchema`.
 *
 * @module @pwfabric/contracts/__tests__/fabric/atom
 */

import { describe, it, expect } from 'vitest'
import { ATOM_KINDS,
  ATOM_KIND_META,
  atomKindMeta,
  isBundledKind,
  resolveSiblingEntry,
  AtomManifestKnowledgeSchema,
  AtomBlockDefinitionMetadataSchema,
  AtomManifestConfigSchema,
  AtomFileManifestSchema,
  DEFAULT_APPEARANCE_THEME,
} from '../../index.js'
import type { AtomRef } from '../../index.js'

// ============================================================
// AtomManifestKnowledgeSchema
// ============================================================

describe('AtomManifestKnowledgeSchema', () => {

  // ──. knowledge.implementation ──────────────────────────────────
  //
  // WHY THIS FIELD EXISTS. The four fields beside it are what the prose
  // generator reads, so every word in them ships on EVERY composer call.
  // A generator that writes a component tends to put the whole build
  // specification into `purpose`. This field is the place that spec goes
  // instead: it stays with the atom, and costs nothing per call.
  it('accepts an optional implementation field', () => {
    const withImpl = { ...valid, implementation: 'Renders a <button>; props: label, tone, size. Tone maps to --pw-color-*.' }
    expect(AtomManifestKnowledgeSchema.safeParse(withImpl).success).toBe(true)
  })

  it('is OPTIONAL — a manifest without it stays valid', () => {
    // Every existing manifest predates the field. Requiring it would have made
    // this an breaking change rather than an additive one.
    expect(AtomManifestKnowledgeSchema.safeParse(valid).success).toBe(true)
  })

  it('does NOT open the object — an arbitrary fifth key still fails', () => {
    // The contract authorises exactly one named field, not a bag. If `.strict()`
    // were relaxed instead, the next stray key would ship silently and the
    // manifest would stop meaning what it says.
    const stray = { ...valid, notes: 'anything' }
    expect(AtomManifestKnowledgeSchema.safeParse(stray).success).toBe(false)
  })

  const valid = {
    purpose: 'Render a primary action button',
    useCases: ['call-to-action on a landing surface'],
    composesWith: ['ui.container'],
    antiPatterns: ['do not nest inside another button'],
  }

  it('accepts a fully-populated knowledge block', () => {
    expect(AtomManifestKnowledgeSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an empty purpose', () => {
    expect(AtomManifestKnowledgeSchema.safeParse({ ...valid, purpose: '' }).success).toBe(false)
  })

  it('rejects an empty useCases array (must have at least one)', () => {
    expect(AtomManifestKnowledgeSchema.safeParse({ ...valid, useCases: [] }).success).toBe(false)
  })

  it('rejects an empty antiPatterns array (must have at least one)', () => {
    expect(AtomManifestKnowledgeSchema.safeParse({ ...valid, antiPatterns: [] }).success).toBe(
      false
    )
  })

  it('accepts an empty composesWith array', () => {
    expect(
      AtomManifestKnowledgeSchema.safeParse({ ...valid, composesWith: [] }).success
    ).toBe(true)
  })

  it('rejects unknown keys (strict)', () => {
    expect(
      AtomManifestKnowledgeSchema.safeParse({ ...valid, extra: 'nope' }).success
    ).toBe(false)
  })
})

// ============================================================
// AtomBlockDefinitionMetadataSchema
// ============================================================

describe('AtomBlockDefinitionMetadataSchema', () => {
  const valid = {
    props: [{ name: 'label', type: 'string' }],
    defaultProps: { label: 'Click me' },
    canHaveChildren: false,
  }

  it('accepts metadata without the optional allowedParents', () => {
    expect(AtomBlockDefinitionMetadataSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts metadata with an allowedParents whitelist', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({
        ...valid,
        allowedParents: ['ui.container', 'ui.form'],
      }).success
    ).toBe(true)
  })

  it('rejects a non-boolean canHaveChildren', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({ ...valid, canHaveChildren: 'yes' }).success
    ).toBe(false)
  })

  it('rejects an empty string inside allowedParents', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({ ...valid, allowedParents: [''] }).success
    ).toBe(false)
  })

  // traits / allowedChildTraits

  it('accepts kebab-case traits and allowedChildTraits', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({
        ...valid,
        traits: ['form-field', 'inline'],
        allowedChildTraits: ['form-field', 'form-content'],
      }).success
    ).toBe(true)
  })

  it('accepts an empty traits array', () => {
    expect(AtomBlockDefinitionMetadataSchema.safeParse({ ...valid, traits: [] }).success).toBe(
      true
    )
  })

  it('rejects non-kebab-case trait names', () => {
    for (const bad of ['FormField', 'form_field', '-leading', '', '2start']) {
      expect(
        AtomBlockDefinitionMetadataSchema.safeParse({ ...valid, traits: [bad] }).success
      ).toBe(false)
    }
  })

  it('rejects non-kebab-case allowedChildTraits names', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({
        ...valid,
        allowedChildTraits: ['Tab Panel'],
      }).success
    ).toBe(false)
  })

  it('still rejects unknown keys with the new fields present (strict)', () => {
    expect(
      AtomBlockDefinitionMetadataSchema.safeParse({
        ...valid,
        traits: ['inline'],
        rogue: true,
      }).success
    ).toBe(false)
  })
})

// ============================================================
// AtomFileManifestSchema
// ============================================================

describe('AtomFileManifestSchema', () => {
  const blockManifest = {
    id: 'ui.button',
    kind: 'block' as const,
    version: '1.0.0',
    name: 'Button',
    state: 'stable' as const,
    category: 'control',
    description: 'A primary action button',
    tags: ['ui', 'action'],
    knowledge: {
      purpose: 'Render a clickable button',
      useCases: ['submit a form'],
      composesWith: [],
      antiPatterns: ['avoid as a page heading'],
    },
    definition: {
      props: [{ name: 'label', type: 'string' }],
      defaultProps: { label: 'Submit' },
      canHaveChildren: false,
    },
  }

  it('accepts a complete block manifest with definition', () => {
    expect(AtomFileManifestSchema.safeParse(blockManifest).success).toBe(true)
  })

  it('accepts a capability manifest without category or definition', () => {
    const { category: _category, definition: _definition, ...rest } = blockManifest
    void _category
    void _definition
    const capManifest = { ...rest, id: 'platform/echo', kind: 'capability' as const }
    expect(AtomFileManifestSchema.safeParse(capManifest).success).toBe(true)
  })

  it('accepts a ui-appearance manifest carrying its theme payload', () => {
    // The regression this guards: appearance became a DATA atom, its token set
    // moved into `manifest.json` under `theme`, and this schema — `.strict()` —
    // was never taught the field. Every shipped theme atom failed its own
    // contract while `useAvailableThemePresets()` read `manifest.theme` happily.
    const { category: _category, definition: _definition, ...rest } = blockManifest
    void _category
    void _definition
    const themeManifest = {
      ...rest,
      id: 'theme-ocean',
      kind: 'ui-appearance' as const,
      name: 'Ocean',
      theme: DEFAULT_APPEARANCE_THEME,
    }
    const result = AtomFileManifestSchema.safeParse(themeManifest)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.theme?.colors?.primary).toBe(DEFAULT_APPEARANCE_THEME.colors?.primary)
  })

  it('rejects a theme payload that is not a surface theme', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...blockManifest, theme: { colors: 'indigo' } }).success
    ).toBe(false)
  })

  /**
   * connector/provider payload fields.
   *
   * `connection` and `configSchema` are NOT new data: connector and provider
   * manifests carry them and hosts read them. They were simply
   * never declared here — and this schema is `.strict()`, so every connector
   * manifest in production fails its own contract. Exactly the gap the
   * `theme` case above documents, one kind over.
   *
   * `scopes` IS new: the delegated permissions a connector needs, which until
   * now existed only as Turkish prose inside `knowledge.configSchema`. A live
   * Entra failure (`AADSTS650053 … scope '["Sites.Read.All"'`) traced back to
   * the platform having no machine-readable form of it.
   */
  const connectorManifest = (() => {
    const { category: _category, definition: _definition, ...rest } = blockManifest
    void _category
    void _definition
    return {
      ...rest,
      id: 'microsoft.sites',
      kind: 'connector' as const,
      name: 'sites',
      connection: 'graph-sites',
      configSchema: { fields: [] },
    }
  })()

  it('accepts a connector manifest carrying connection + configSchema', () => {
    const result = AtomFileManifestSchema.safeParse(connectorManifest)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.connection).toBe('graph-sites')
  })

  it('accepts a declared scope set, with adminConsent and reason', () => {
    const result = AtomFileManifestSchema.safeParse({
      ...connectorManifest,
      scopes: [
        { name: 'Sites.Read.All', reason: 'Reads the SharePoint site catalogue' },
        { name: 'Sites.ReadWrite.All', adminConsent: true, reason: 'Writes list records' },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scopes?.[0]?.name).toBe('Sites.Read.All')
      expect(result.data.scopes?.[1]?.adminConsent).toBe(true)
      // Absent adminConsent stays absent — "not stated" is not "false".
      expect(result.data.scopes?.[0]?.adminConsent).toBeUndefined()
    }
  })

  it('accepts an atom that declares no scopes — absent means "needs none"', () => {
    expect(AtomFileManifestSchema.safeParse(connectorManifest).success).toBe(true)
  })

  it('accepts an explicitly empty scope set', () => {
    expect(AtomFileManifestSchema.safeParse({ ...connectorManifest, scopes: [] }).success).toBe(true)
  })

  /**
   * A bare string list is the shape the OLD prose-and-guesswork world would
   * have produced. Rejecting it is the point: a declaration says WHY it is
   * needed and whether an admin must consent, and those two facts are what
   * the canvas card has to show.
   */
  it('rejects a bare string[] scope list — a declaration is not a name list', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...connectorManifest, scopes: ['Sites.Read.All'] }).success
    ).toBe(false)
  })

  it('rejects a scope declaration with no name', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...connectorManifest, scopes: [{ reason: 'why' }] }).success
    ).toBe(false)
  })

  it('rejects an empty scope name', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...connectorManifest, scopes: [{ name: '' }] }).success
    ).toBe(false)
  })

  it('stays strict — an undeclared payload field is still rejected', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...connectorManifest, somethingUndeclared: true }).success
    ).toBe(false)
  })

  it('accepts every atom kind', () => {
    for (const kind of ATOM_KINDS) {
      expect(AtomFileManifestSchema.safeParse({ ...blockManifest, kind }).success).toBe(true)
    }
  })

  it('accepts every lifecycle state', () => {
    for (const state of ['stable', 'beta', 'alpha', 'deprecated', 'experimental'] as const) {
      expect(AtomFileManifestSchema.safeParse({ ...blockManifest, state }).success).toBe(true)
    }
  })

  it('rejects an unknown kind', () => {
    expect(AtomFileManifestSchema.safeParse({ ...blockManifest, kind: 'widget' }).success).toBe(
      false
    )
  })

  it('rejects an unknown lifecycle state', () => {
    expect(AtomFileManifestSchema.safeParse({ ...blockManifest, state: 'retired' }).success).toBe(
      false
    )
  })

  it('rejects an empty id', () => {
    expect(AtomFileManifestSchema.safeParse({ ...blockManifest, id: '' }).success).toBe(false)
  })

  it('rejects a manifest with a missing knowledge block', () => {
    const { knowledge: _knowledge, ...withoutKnowledge } = blockManifest
    void _knowledge
    expect(AtomFileManifestSchema.safeParse(withoutKnowledge).success).toBe(false)
  })

  it('rejects unknown top-level keys (strict)', () => {
    expect(
      AtomFileManifestSchema.safeParse({ ...blockManifest, rogue: true }).success
    ).toBe(false)
  })

  it('accepts a definition carrying traits + allowedChildTraits', () => {
    expect(
      AtomFileManifestSchema.safeParse({
        ...blockManifest,
        definition: {
          ...blockManifest.definition,
          canHaveChildren: true,
          traits: ['modal-content'],
          allowedChildTraits: ['form-field', 'form-content'],
        },
      }).success
    ).toBe(true)
  })

  it('accepts a capability manifest carrying config', () => {
    const { category: _category, definition: _definition, ...rest } = blockManifest
    void _category
    void _definition
    const capManifest = {
      ...rest,
      id: 'platform/persistence',
      kind: 'capability' as const,
      config: {
        fields: [
          {
            key: 'defaultCacheTtl',
            type: 'number' as const,
            required: false,
            defaultValue: 300,
            label: 'Default cache TTL',
            constraints: { min: 0, max: 86400 },
          },
          {
            key: 'storageKey',
            type: 'string' as const,
            required: true,
            label: 'Storage key',
            sensitive: true,
          },
        ],
      },
    }
    expect(AtomFileManifestSchema.safeParse(capManifest).success).toBe(true)
  })

  it('rejects config with an unknown field key (strict)', () => {
    const capManifest = {
      ...blockManifest,
      config: { fields: [{ key: 'x', type: 'string', required: false, label: 'X', rogue: 1 }] },
    }
    expect(AtomFileManifestSchema.safeParse(capManifest).success).toBe(false)
  })
})

// ============================================================
// AtomManifestConfigSchema
// ============================================================

describe('AtomManifestConfigSchema', () => {
  it('accepts an empty field list', () => {
    expect(AtomManifestConfigSchema.safeParse({ fields: [] }).success).toBe(true)
  })

  it('accepts every config field type', () => {
    for (const type of [
      'string',
      'number',
      'boolean',
      'select',
      'multi-select',
      'url',
      'email',
      'json',
    ] as const) {
      expect(
        AtomManifestConfigSchema.safeParse({
          fields: [{ key: 'k', type, required: false, label: 'K' }],
        }).success
      ).toBe(true)
    }
  })

  it('accepts select options and constraints', () => {
    expect(
      AtomManifestConfigSchema.safeParse({
        fields: [
          {
            key: 'mode',
            type: 'select',
            required: true,
            label: 'Mode',
            options: [{ value: 'a', label: 'A', description: 'first' }],
            constraints: { pattern: '^a$', patternMessage: 'must be a' },
          },
        ],
      }).success
    ).toBe(true)
  })

  it('rejects an unknown field type', () => {
    expect(
      AtomManifestConfigSchema.safeParse({
        fields: [{ key: 'k', type: 'date', required: false, label: 'K' }],
      }).success
    ).toBe(false)
  })

  it('rejects a field missing its label', () => {
    expect(
      AtomManifestConfigSchema.safeParse({
        fields: [{ key: 'k', type: 'string', required: false }],
      }).success
    ).toBe(false)
  })

  it('rejects unknown top-level keys (strict)', () => {
    expect(AtomManifestConfigSchema.safeParse({ fields: [], rogue: true }).success).toBe(false)
  })
})

// ============================================================
// ATOM_KIND_META
// ============================================================

describe('ATOM_KIND_META', () => {
  it('has an entry for every AtomKind (exhaustiveness)', () => {
    for (const kind of ATOM_KINDS) {
      expect(ATOM_KIND_META[kind]).toBeDefined()
      expect(ATOM_KIND_META[kind].kind).toBe(kind)
    }
    expect(Object.keys(ATOM_KIND_META).sort()).toEqual([...ATOM_KINDS].sort())
  })

  it('atomKindMeta(kind) returns the dictionary entry', () => {
    for (const kind of ATOM_KINDS) {
      expect(atomKindMeta(kind)).toBe(ATOM_KIND_META[kind])
    }
  })

  // Documented current behaviour for all 9 kinds.
  const expected: Record<
    (typeof ATOM_KINDS)[number],
    { bundled: boolean; entry: string; payloadShape: string; onFailure: string }
  > = {
    block: { bundled: true, entry: 'identity', payloadShape: 'bundle', onFailure: 'abort' },
    surface: { bundled: false, entry: 'none', payloadShape: 'json-payload', onFailure: 'abort' },
    capability: { bundled: true, entry: 'identity', payloadShape: 'bundle', onFailure: 'abort' },
    'ui-appearance': {
      bundled: false,
      entry: 'none',
      payloadShape: 'json-payload',
      onFailure: 'abort',
    },
    pattern: { bundled: false, entry: 'none', payloadShape: 'json-payload', onFailure: 'abort' },
    'icon-set': { bundled: false, entry: 'none', payloadShape: 'json-payload', onFailure: 'abort' },
    connector: {
      bundled: true,
      entry: 'sibling-generated',
      payloadShape: 'json-payload',
      onFailure: 'degrade',
    },
    provider: {
      bundled: true,
      entry: 'sibling-generated',
      payloadShape: 'json-payload',
      onFailure: 'degrade',
    },
    'auth-provider': {
      bundled: false,
      entry: 'none',
      payloadShape: 'source-only',
      onFailure: 'abort',
    },
  }

  it('matches the documented bundled/entry/payloadShape/onFailure for all 9 kinds', () => {
    for (const kind of ATOM_KINDS) {
      const meta = ATOM_KIND_META[kind]
      expect(meta.bundled).toBe(expected[kind].bundled)
      expect(meta.entry).toBe(expected[kind].entry)
      expect(meta.payloadShape).toBe(expected[kind].payloadShape)
      expect(meta.onFailure).toBe(expected[kind].onFailure)
    }
  })

  it('marks block + capability with the precompiled .mjs fallback', () => {
    expect(ATOM_KIND_META.block.precompiledFallback).toBe(true)
    expect(ATOM_KIND_META.capability.precompiledFallback).toBe(true)
  })

  it('isBundledKind equals the old block||capability set PLUS connector+provider', () => {
    const bundled = ATOM_KINDS.filter((k) => isBundledKind(k)).sort()
    expect(bundled).toEqual(['block', 'capability', 'connector', 'provider'].sort())
  })

  it('only connector + provider carry a siblingEntry descriptor', () => {
    for (const kind of ATOM_KINDS) {
      const hasSibling = ATOM_KIND_META[kind].siblingEntry !== undefined
      expect(hasSibling).toBe(kind === 'connector' || kind === 'provider')
    }
  })
})

// ============================================================
// resolveSiblingEntry
// ============================================================

describe('resolveSiblingEntry', () => {
  it('derives connector engine + wrapper paths from a knowledge.json relPath', () => {
    expect(resolveSiblingEntry('connector', 'connectors/Weather.knowledge.json')).toEqual({
      enginePath: 'connectors/Weather.ts',
      wrapperPath: 'connectors/Weather.__engine__.ts',
    })
  })

  it('derives provider engine + wrapper + shared motor paths', () => {
    expect(
      resolveSiblingEntry('provider', 'providers/microsoft/entities/mail.knowledge.json')
    ).toEqual({
      enginePath: 'providers/microsoft/entities/mail.ts',
      wrapperPath: 'providers/microsoft/entities/mail.__engine__.ts',
      sharedMotorPath: 'providers/microsoft/index.ts',
    })
  })

  it('returns null for a non-sibling kind', () => {
    expect(resolveSiblingEntry('block', 'blocks/control/button/component.tsx')).toBeNull()
  })

  it('returns null when the relPath does not match the knowledge pattern', () => {
    expect(resolveSiblingEntry('connector', 'connectors/Weather.ts')).toBeNull()
    expect(resolveSiblingEntry('provider', 'providers/microsoft/mail.knowledge.json')).toBeNull()
  })
})

// ============================================================
// AtomRef.bundleSizeBytes
// ============================================================

describe('AtomRef bundleSizeBytes', () => {
  it('accepts an AtomRef carrying bundleSizeBytes', () => {
    const ref: AtomRef = {
      kind: 'block',
      id: 'control.button',
      relPath: 'blocks/control/button/component.tsx',
      bundleUrl: 'pwpacks/x/1.0.0/bundles/block/control.button.bundle.mjs',
      bundleHash: 'abc123',
      bundleSizeBytes: 2048,
    }
    expect(ref.bundleSizeBytes).toBe(2048)
  })

  it('accepts an AtomRef without bundleSizeBytes (optional)', () => {
    const ref: AtomRef = {
      kind: 'surface',
      id: 'marketing.hero',
      relPath: 'surfaces/marketing/hero.receipt.json',
    }
    expect(ref.bundleSizeBytes).toBeUndefined()
  })
})

/**
 * a connector atom declares its engine.
 *
 * A class has a call signature to get wrong: one options object where the
 * runtime passes two positional arguments is enough to ask for
 * `lists/undefined`.
 * A declaration has no signature. What it must also not have is anything
 * executable — that is what these tests hold.
 */
describe('AtomFileManifest.engine — a declaration, not code', () => {
  /** The graph-lists engine. */
  const GRAPH_LISTS = {
    host: 'graph.microsoft.com/v1.0',
    resolve: { path: '/sites/{siteHostname}:{sitePath}', field: 'id', as: 'siteId' },
    path: '/sites/{siteId}/lists/{entityType}/items',
    params: { expand: 'fields' },
    auth: { type: 'bearer' as const },
    read: { items: 'value', id: 'id', flatten: 'fields', lift: ['webUrl', 'createdDateTime'] },
    write: { bodyWrap: 'fields' },
    transforms: [{ field: 'Icon', use: 'sharepoint-image' }],
  }

  const connectorManifest = {
    id: 'graph-lists',
    kind: 'connector' as const,
    version: '1.0.0',
    name: 'SharePoint Listeleri',
    state: 'stable' as const,
    connection: 'graph-lists',
    knowledge: {
      purpose: 'Read and write SharePoint lists through Microsoft Graph',
      useCases: ['list candidates from a SharePoint list'],
      composesWith: [],
      antiPatterns: ['do not use for non-SharePoint REST APIs'],
    },
  }

  it('accepts the graph-lists declaration', () => {
    const result = AtomFileManifestSchema.safeParse({ ...connectorManifest, engine: GRAPH_LISTS })
    expect(result.success).toBe(true)
  })

  it('a manifest with NO engine stays valid — the additive property', () => {
    expect(AtomFileManifestSchema.safeParse(connectorManifest).success).toBe(true)
  })

  it('refuses a declaration missing the path', () => {
    const { path: _path, ...noPath } = GRAPH_LISTS
    const result = AtomFileManifestSchema.safeParse({ ...connectorManifest, engine: noPath })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toContain('path')
  })

  it('refuses a declaration missing read.items', () => {
    const engine = { ...GRAPH_LISTS, read: { id: 'id' } }
    const result = AtomFileManifestSchema.safeParse({ ...connectorManifest, engine })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path.join('.')).toContain('read')
  })

  it('refuses anything executable — a transform must be a NAME, never a function', () => {
    const engine = { ...GRAPH_LISTS, transforms: [{ field: 'Icon', use: () => 'x' }] }
    expect(AtomFileManifestSchema.safeParse({ ...connectorManifest, engine }).success).toBe(false)
  })

  it('refuses an unknown key — a credential cannot be smuggled in beside auth', () => {
    const engine = { ...GRAPH_LISTS, auth: { type: 'bearer', token: 'sk-live-nope' } }
    const result = AtomFileManifestSchema.safeParse({ ...connectorManifest, engine })
    expect(result.success).toBe(false)
  })

  it('refuses an unknown key at the declaration root too', () => {
    const engine = { ...GRAPH_LISTS, apiKey: 'nope' }
    expect(AtomFileManifestSchema.safeParse({ ...connectorManifest, engine }).success).toBe(false)
  })
})
