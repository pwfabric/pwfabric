/**
 * Pwpack Atom Contract Types
 *
 * Symmetric pwpack authoring — every first-party artifact
 * (block, surface, capability) lives as an atom inside a pwpack source
 * directory and is installed through the same pipeline.
 *
 * Per-atom `manifest.json` files carry a 4-field
 * `knowledge` block (`purpose | useCases | composesWith | antiPatterns`)
 * that a publish pipeline parses and an install pipeline stores with the
 * atom. Composers read it to choose the right atom for a composition without
 * loading the bundle.
 *
 * @module @pwfabric/contracts/fabric/atom
 */

import { z } from 'zod'
import { surfaceThemeSchema } from './surface-schema.js'
import type { SurfaceTheme } from './surface-theme.js'
// A leaf import: project-identity.ts depends on zod alone, so reading the
// closed method list here adds no cycle in either direction.
import { IDENTITY_METHODS, type IdentityMethod } from './project-identity.js'

// Version fields intentionally kept as `string` (not SemanticVersion) — atoms
// and pack manifests move through storage as serialised strings.

// ============================================================
// ATOM KIND
// ============================================================

/**
 * Atom kinds that a pwpack may contain.
 *
 * - `block`          — L1 primitive UI block (rendered in a surface).
 * - `surface` — L2 surface template receipt.
 * - `capability`     — L3 runtime capability definition.
 * - `ui-appearance`  — L4 visual appearance atom — theme + layout + styleVariables
 * unified cascade engine. The `ui-*` namespace is
 *                      reserved for future visual atom kinds (ui-motion,
 *                      ui-typography, etc.).
 *
 * Catalogue kinds — the remaining parts an app catalogue pack carries beside
 * blocks, surfaces and capabilities, so that install keeps them and a composer
 * can see them:
 *
 * - `pattern`        — proven block arrangement, one JSON file per pattern
 *                      (`patterns/<name>.json`). Bundleless: the file IS the atom.
 * - `icon-set`       — the icon dictionary (`icons/icons.json`). Bundleless.
 * - `connector`      — data engine (`connectors/<Name>.ts` + sibling
 *                      `.knowledge.json`); the knowledge file is the
 *                      catalogue-facing payload, source stays in the tgz.
 * - `provider`       — provider-entity facet (`providers/<prov>/entities/
 *                      <entity>.knowledge.json`) — one atom per entity so the
 *                      composer catalogue sees each facet, the motor source
 *                      travels in the tgz.
 * - `auth-provider`  — auth surface of the pack (`auth/`). Two forms: the
 *                      runtime (`auth/AuthProvider.*`, id `auth`) and one atom
 *                      per identity method (`auth/<method>.knowledge.json`,
 *                      id `auth.<method>`, method ∈ `IDENTITY_METHODS`).
 *                      Source-only as a kind: no bundle; a knowledge file, when
 *                      shipped, is persisted verbatim as the atom manifest.
 *
 * A single pwpack may mix kinds (e.g. a first-party UI pack ships `block` + `surface`).
 * Appearance-only packs keep their manifest lean
 * (`atoms.length === 1`).
 *
 * The prose above is the human-readable twin of {@link ATOM_KIND_META} — the
 * machine-readable per-kind bundling facts. Downstream bundlers
 * (the publish pipeline, and classification on the platform side) MUST read the
 * dictionary rather than re-encode these facts as ad-hoc allowlists or regexes.
 */
export const ATOM_KINDS = [
  'block',
  'surface',
  'capability',
  'ui-appearance',
  'pattern',
  'icon-set',
  'connector',
  'provider',
  'auth-provider',
] as const

export type AtomKind = (typeof ATOM_KINDS)[number]

// ============================================================
// ATOM KIND BUNDLING METADATA
// ============================================================

/**
 * How the bundler locates an atom's executable source.
 *
 * - `identity`         — the atom's `relPath` IS the esbuild entry
 *                        (`block`/`capability` source). See
 *                        {@link AtomKindMeta.precompiledFallback} for the
 *                        `.mjs` short-circuit.
 * - `precompiled`      — the `relPath` is an already-bundled ESM module; no
 *                        transform. Reached at runtime as the `.mjs` fallback of
 *                        an `identity` kind, not declared as a kind's primary
 *                        entry today.
 * - `sibling-generated`— the catalogued file is `knowledge.json`; the executable
 *                        source is a SIBLING and the bundler synthesises a
 *                        wrapper entry (`connector`/`provider`). See
 *                        {@link AtomKindMeta.siblingEntry}.
 * - `none`             — non-bundled kind; nothing to locate.
 */
export type AtomKindEntry = 'identity' | 'precompiled' | 'sibling-generated' | 'none'

/**
 * The shape of the payload the install side persists for an atom.
 *
 * - `bundle`       — an executable/loadable ESM bundle (blocks, capabilities).
 * - `json-payload` — a JSON file that IS the manifest/payload (patterns, icon
 *                    sets, surfaces, ui-appearance, AND connector/provider
 *                    `knowledge.json` — which are *also* `bundled`).
 * - `source-only`  — source travels in the tgz but yields no JSON payload and
 *                    no bundle; install persists a lean row (auth-provider).
 */
export type AtomKindPayloadShape = 'bundle' | 'json-payload' | 'source-only'

/**
 * What the publish pipeline does when an atom's bundle step fails.
 *
 * - `abort`   — a broken block/capability fails the whole publish.
 * - `degrade` — a broken connector/provider engine passes through un-bundled
 *               (knowledge-only) with a warning; the publish never aborts.
 */
export type AtomKindFailureMode = 'abort' | 'degrade'

/**
 * How a `sibling-generated` kind derives its engine source + synthesised
 * wrapper from a `knowledge.json` `relPath`. Modelled as data (regex source +
 * `$n` capture-group templates) so consumers apply it rather than re-derive it.
 *
 * @example connector `connectors/<Name>.knowledge.json`
 *   → engine `connectors/<Name>.ts`, wrapper `connectors/<Name>.__engine__.ts`
 * @example provider `providers/<vendor>/entities/<domain>.knowledge.json`
 *   → engine `providers/<vendor>/entities/<domain>.ts`,
 *     wrapper `providers/<vendor>/entities/<domain>.__engine__.ts`,
 *     shared motor `providers/<vendor>/index.ts`
 */
export interface AtomKindSiblingEntry {
  /** RegExp source that matches the `knowledge.json` relPath, with capture groups. */
  readonly knowledgePattern: string
  /** Engine source path template; `$1`, `$2` = capture groups of `knowledgePattern`. */
  readonly engineTemplate: string
  /** Synthesised wrapper module path template (`$n` interpolated). */
  readonly wrapperTemplate: string
  /** Shared per-vendor motor path template (`provider` only; `$n` interpolated). */
  readonly sharedMotorTemplate?: string
}

/**
 * Per-kind bundling facts — the single source of truth for how the pwpack
 * publish/install pipeline treats each {@link AtomKind}. Consumed by the
 * publisher's bundle allowlist and by a host's classify and connector-engine
 * bundling paths, so none of them re-encodes the path rules.
 */
export interface AtomKindMeta {
  readonly kind: AtomKind
  /** Carries an executable/loadable bundle (block, capability, connector, provider). */
  readonly bundled: boolean
  /** How the bundler locates the executable source. */
  readonly entry: AtomKindEntry
  /**
   * When `true`, an `identity`-entry atom whose `relPath` ends `.mjs` is treated
   * as already-compiled (esbuild skipped). Today only `block` ships a
   * `bundle.mjs` (precompiled block re-host); `capability` carries the same rule
   * but emits no `.mjs` in practice.
   */
  readonly precompiledFallback?: boolean
  /** Shape of the persisted payload. */
  readonly payloadShape: AtomKindPayloadShape
  /** Publish-failure policy for the bundle step (irrelevant → `abort` for non-bundled kinds). */
  readonly onFailure: AtomKindFailureMode
  /**
   * Documented `relPath` convention `classifyAtom` recognises for this kind.
   * The exact conventions {@link classifyAtom} implements.
   */
  readonly pathConvention: string
  /** Sibling-source derivation rule (`sibling-generated` kinds only). */
  readonly siblingEntry?: AtomKindSiblingEntry
}

/**
 * Machine-readable per-kind bundling metadata. Declared ONCE here so publish
 * allowlists, path classification and connector-engine sibling derivation
 * consume it instead of drifting.
 *
 * Mirrors the documented behaviour EXACTLY (see the prose on
 * {@link ATOM_KINDS} and {@link classifyAtom}):
 * - `block`, `capability`             → bundled ESM (`abort` on failure)
 * - `connector`, `provider`           → bundled from a sibling engine, but the
 *                                       `knowledge.json` is also the payload;
 *                                       failure `degrade`s (never aborts)
 * - `surface`, `ui-appearance`,
 *   `pattern`, `icon-set`             → JSON payload, not bundled
 * - `auth-provider`                   → source-only (`.tsx`), not bundled
 */
export const ATOM_KIND_META = {
  block: {
    kind: 'block',
    bundled: true,
    entry: 'identity',
    precompiledFallback: true,
    payloadShape: 'bundle',
    onFailure: 'abort',
    pathConvention: 'blocks/*/component.tsx (precompiled: blocks/*/bundle.mjs)',
  },
  surface: {
    kind: 'surface',
    bundled: false,
    entry: 'none',
    payloadShape: 'json-payload',
    onFailure: 'abort',
    pathConvention: 'surfaces/**/*.receipt.json',
  },
  capability: {
    kind: 'capability',
    bundled: true,
    entry: 'identity',
    precompiledFallback: true,
    payloadShape: 'bundle',
    onFailure: 'abort',
    pathConvention: 'capabilities/*/handler.ts',
  },
  'ui-appearance': {
    kind: 'ui-appearance',
    bundled: false,
    entry: 'none',
    payloadShape: 'json-payload',
    onFailure: 'abort',
    pathConvention: 'appearance/*/manifest.json',
  },
  pattern: {
    kind: 'pattern',
    bundled: false,
    entry: 'none',
    payloadShape: 'json-payload',
    onFailure: 'abort',
    pathConvention: 'patterns/*.json',
  },
  'icon-set': {
    kind: 'icon-set',
    bundled: false,
    entry: 'none',
    payloadShape: 'json-payload',
    onFailure: 'abort',
    pathConvention: 'icons/icons.json',
  },
  connector: {
    kind: 'connector',
    bundled: true,
    entry: 'sibling-generated',
    payloadShape: 'json-payload',
    onFailure: 'degrade',
    pathConvention: 'connectors/*.knowledge.json',
    siblingEntry: {
      knowledgePattern: '^connectors/([^/]+)\\.knowledge\\.json$',
      engineTemplate: 'connectors/$1.ts',
      wrapperTemplate: 'connectors/$1.__engine__.ts',
    },
  },
  provider: {
    kind: 'provider',
    bundled: true,
    entry: 'sibling-generated',
    payloadShape: 'json-payload',
    onFailure: 'degrade',
    pathConvention: 'providers/*/entities/*.knowledge.json',
    siblingEntry: {
      knowledgePattern: '^providers/([^/]+)/entities/([^/]+)\\.knowledge\\.json$',
      engineTemplate: 'providers/$1/entities/$2.ts',
      wrapperTemplate: 'providers/$1/entities/$2.__engine__.ts',
      sharedMotorTemplate: 'providers/$1/index.ts',
    },
  },
  'auth-provider': {
    kind: 'auth-provider',
    bundled: false,
    entry: 'none',
    payloadShape: 'source-only',
    onFailure: 'abort',
    pathConvention: 'auth/AuthProvider.{knowledge.json,tsx} (runtime, id auth); auth/<method>.knowledge.json (one per IDENTITY_METHODS entry, id auth.<method>)',
  },
} as const satisfies Record<AtomKind, AtomKindMeta>

/** Look up the {@link AtomKindMeta} for a kind. */
export function atomKindMeta(kind: AtomKind): AtomKindMeta {
  return ATOM_KIND_META[kind]
}

/**
 * Whether a kind carries an executable/loadable bundle. Equals the legacy
 * `block || capability` set PLUS `connector` + `provider`.
 */
export function isBundledKind(kind: AtomKind): boolean {
  return ATOM_KIND_META[kind].bundled
}

/**
 * Resolve a `sibling-generated` kind's engine + wrapper (+ shared motor) paths
 * from a `knowledge.json` relPath by applying its {@link AtomKindSiblingEntry}.
 * Returns `null` for non-sibling kinds or a relPath that does not match the
 * kind's `knowledgePattern`.
 */
export function resolveSiblingEntry(
  kind: AtomKind,
  relPath: string
): { enginePath: string; wrapperPath: string; sharedMotorPath?: string } | null {
  const meta: AtomKindMeta = ATOM_KIND_META[kind]
  const sib = meta.siblingEntry
  if (!sib) return null
  const match = new RegExp(sib.knowledgePattern).exec(relPath)
  if (!match) return null
  const apply = (template: string): string =>
    template.replace(/\$(\d+)/g, (_whole, n: string) => match[Number(n)] ?? '')
  const result: { enginePath: string; wrapperPath: string; sharedMotorPath?: string } = {
    enginePath: apply(sib.engineTemplate),
    wrapperPath: apply(sib.wrapperTemplate),
  }
  if (sib.sharedMotorTemplate) {
    result.sharedMotorPath = apply(sib.sharedMotorTemplate)
  }
  return result
}

// ============================================================
// PATH CLASSIFICATION
// ============================================================

/** What a pwpack-relative path classifies as. */
export interface AtomClassification {
  readonly kind: AtomKind
  /** The atom id derived from the path, per that kind's convention. */
  readonly id: string
}

/** The canonical pwpack folder's atom root. */
const CANONICAL_ATOMS_ROOT = 'atoms/'
/** Shared code under the atom root — compiler companions, never atoms. */
const CANONICAL_LIB_ROOT = 'atoms/lib/'
/** The canonical pwpack folder's declaration root (read by ingest). */
const CANONICAL_APP_ROOT = 'app/'
/** The pack identity file at the root of the canonical folder. */
const PACK_IDENTITY_FILE = 'pwpack.json'
/** Legacy rootless shared code — the same companions, before the `atoms/` root existed. */
const ROOTLESS_LIB_ROOT = 'lib/'

/**
 * Which atom a pwpack-relative path becomes, or `null` if it is inert cargo.
 *
 * WHY IT LIVES HERE. A pack author, a pack tool and a host must all classify
 * a path the same way, and each {@link AtomKindMeta} carries the
 * `pathConvention` this function implements. Keeping the code next to that
 * data, in the package every consumer already depends on, is what lets the
 * two be measured against each other.
 *
 * ID DERIVATION MUST MATCH THE MANIFEST PRODUCER EXACTLY. A mismatched id is
 * recorded in `manifest.atoms[]` and then no consumer can resolve it — the
 * atom is present and unreachable, which is worse than absent.
 *
 * A `null` return means INERT CARGO: the file travels inside the tgz but never
 * becomes an atom. That is a real and intended category (a connector's engine
 * `.ts` sibling, a README), not a failure — but it is also how the
 * `ui-appearance` convention went unnoticed for months, walked into every pack
 * and entered no manifest. Anything the caller cannot account for as cargo is
 * worth reporting rather than dropping.
 */
export function classifyAtom(relPath: string): AtomClassification | null {
  // In the canonical pwpack folder every atom sits under
  // the `atoms/` root. `atoms/` is a ROOT, not part of the id, so
  // `atoms/<family>/…` classifies exactly as the legacy rootless
  // `<family>/…` does. Stripped once: `atoms/lib/…` becomes `lib/…`, which no
  // family rule matches, so shared code stays `null` here (see
  // {@link classifyPackPath} for what it IS). Every path that does not start
  // with `atoms/` takes the unchanged rootless rules below.
  const rootless = relPath.startsWith(CANONICAL_ATOMS_ROOT)
    ? relPath.slice(CANONICAL_ATOMS_ROOT.length)
    : relPath
  return classifyRootlessAtom(rootless)
}

/** What a path in a pwpack folder is. `null` from {@link classifyPackPath} means inert cargo. */
export type PackPathClassification =
  /** The path becomes an atom; `atom` is exactly `classifyAtom(relPath)`. */
  | { readonly kind: 'atom'; readonly atom: AtomClassification }
  /**
   * Shared code the compiler takes as companions: `atoms/lib/…` (canonical) or
   * rootless `lib/…` (legacy). `rel` is the path below that root.
   */
  | { readonly kind: 'lib'; readonly rel: string }
  /** `app/…` — the app declaration, read by ingest. `rel` is the path below `app/`. */
  | { readonly kind: 'app'; readonly rel: string }
  /** `pwpack.json` at the folder root — the pack identity. */
  | { readonly kind: 'identity' }

/**
 * What a pwpack-relative path is in the canonical folder.
 *
 * Accepts both layouts: a legacy rootless atom path (`blocks/…`) and its
 * canonical form (`atoms/blocks/…`) both return `{ kind: 'atom' }` with the
 * identical classification. Shared code is `lib` in both layouts too:
 * `atoms/lib/…` (canonical) and rootless `lib/…` (legacy — the platform's pack
 * transfer still emits it, and blocks import from it) both return `lib` with
 * `rel` below the root; `lib` is not an atom family, so {@link classifyAtom}
 * keeps returning `null` for both. The canonical-only roots are `app/…`
 * (`app`) and a root `pwpack.json` (`identity`); a `package.json` is NOT
 * identity. Everything else is `null`: inert cargo.
 */
export function classifyPackPath(relPath: string): PackPathClassification | null {
  if (relPath === PACK_IDENTITY_FILE) return { kind: 'identity' }
  if (relPath.startsWith(CANONICAL_APP_ROOT) && relPath.length > CANONICAL_APP_ROOT.length) {
    return { kind: 'app', rel: relPath.slice(CANONICAL_APP_ROOT.length) }
  }
  if (relPath.startsWith(CANONICAL_LIB_ROOT) && relPath.length > CANONICAL_LIB_ROOT.length) {
    return { kind: 'lib', rel: relPath.slice(CANONICAL_LIB_ROOT.length) }
  }
  if (relPath.startsWith(ROOTLESS_LIB_ROOT) && relPath.length > ROOTLESS_LIB_ROOT.length) {
    return { kind: 'lib', rel: relPath.slice(ROOTLESS_LIB_ROOT.length) }
  }
  const atom = classifyAtom(relPath)
  return atom ? { kind: 'atom', atom } : null
}

/** The legacy rootless rules — the body `classifyAtom` had before the `atoms/` root existed, unchanged. */
function classifyRootlessAtom(relPath: string): AtomClassification | null {
  const parts = relPath.split('/')
  const last = parts[parts.length - 1] ?? ''
  if (parts[0] === 'blocks' && parts.length >= 3 && last === 'component.tsx') {
    return { kind: 'block', id: parts.slice(1, -1).join('.') }
  }
  // Precompiled block: no source, an already-bundled ESM module fetched at
  // pack-assembly time (e.g. a Project export/publish re-hosting a block it
  // only has an installed bundleUrl for, never source). SAME `kind` and `id`
  // derivation as the component.tsx case; the caller distinguishes the two by
  // relPath suffix and skips esbuild for this one.
  if (parts[0] === 'blocks' && parts.length >= 3 && last === 'bundle.mjs') {
    return { kind: 'block', id: parts.slice(1, -1).join('.') }
  }
  if (parts[0] === 'surfaces' && parts.length >= 2 && last.endsWith('.receipt.json')) {
    const leaf = last.replace(/\.receipt\.json$/, '')
    return { kind: 'surface', id: [...parts.slice(1, -1), leaf].join('.') }
  }
  if (parts[0] === 'capabilities' && parts.length >= 3 && last === 'handler.ts') {
    return { kind: 'capability', id: `platform/${parts[1] ?? 'unknown'}` }
  }
  // ui-appearance: a real, in-use convention (e.g. a first-party pack's appearance/<theme>)
  // that went unclassified for months — walked into the tgz as inert cargo and
  // never entered manifest.atoms[], so it was invisible to both bundling and
  // install fan-out.
  if (parts[0] === 'appearance' && parts.length >= 2 && last === 'manifest.json') {
    return { kind: 'ui-appearance', id: parts.slice(1, -1).join('.') }
  }
  // Catalogue kinds — patterns, icons, connectors, providers, auth.
  if (parts[0] === 'patterns' && parts.length === 2 && last.endsWith('.json')) {
    return { kind: 'pattern', id: last.replace(/\.json$/, '') }
  }
  if (parts[0] === 'icons' && last === 'icons.json') {
    return { kind: 'icon-set', id: 'icons' }
  }
  // connector/provider atoms classify by their knowledge JSON (the payload
  // file); their ENGINE sources travel as inert cargo here and are compiled at
  // PUBLISH time from `siblingEntry` above — which is why this function and
  // `resolveSiblingEntry` belong in the same file.
  if (parts[0] === 'connectors' && parts.length === 2 && last.endsWith('.knowledge.json')) {
    return { kind: 'connector', id: last.replace(/\.knowledge\.json$/, '') }
  }
  if (
    parts[0] === 'providers' &&
    parts.length === 4 &&
    parts[2] === 'entities' &&
    last.endsWith('.knowledge.json')
  ) {
    return { kind: 'provider', id: `${parts[1]}.${last.replace(/\.knowledge\.json$/, '')}` }
  }
  // Auth-provider knowledge fold. When a pack ships
  // `auth/AuthProvider.knowledge.json`, THAT file is the auth atom: install's
  // "JSON atoms are their own payload" rule then persists the knowledge verbatim
  // as the atom manifest. ORDER IS LOAD-BEARING at the call site, not here — a
  // sorted walk classifies `.knowledge.json` before `.tsx` ('k' < 't'), so the
  // knowledge file wins the atomMap dedup. Packs without it (older bases) fall
  // through to the source rule below and keep the lean source-only row.
  if (parts[0] === 'auth' && last === 'AuthProvider.knowledge.json') {
    return { kind: 'auth-provider', id: 'auth' }
  }
  if (parts[0] === 'auth' && last === 'AuthProvider.tsx') {
    return { kind: 'auth-provider', id: 'auth' }
  }
  /**
   * ONE ATOM PER WAY IN.
   *
   * `auth` above is the identity pack's RUNTIME — the provider component and
   * the knowledge that describes it. It says nothing about WHICH doors a world
   * can offer, and that is the question an app builder has to answer before
   * it puts sign-in into an app: it may only choose a method the world
   * actually has, never invent one. So each method ships as its own knowledge file,
   * `auth/<method>.knowledge.json`, and becomes its own row — installing the
   * pack is what makes a method choosable, uninstalling it is what takes it
   * away.
   *
   * The method must be one of {@link IDENTITY_METHODS}. That list is closed on
   * purpose (it is what the host's authorization server implements), and a
   * file named after anything else is inert cargo rather than an atom: a row
   * called `auth.bogus` would be offered to an app builder as a door nobody
   * can open. Only the knowledge file classifies — a `auth/<method>.tsx` is source
   * the runtime imports, not a second atom with the same id.
   *
   * Depth is exactly two, like connectors: `auth/<method>.knowledge.json`, so
   * a nested `auth/x/password.knowledge.json` is not a method either.
   */
  if (parts[0] === 'auth' && parts.length === 2 && last.endsWith('.knowledge.json')) {
    const method = identityMethodOf(last.slice(0, -'.knowledge.json'.length))
    return method ? { kind: 'auth-provider', id: `${AUTH_METHOD_ATOM_PREFIX}${method}` } : null
  }
  return null
}

/** The id prefix every per-method auth-provider atom carries: `auth.<method>`. */
const AUTH_METHOD_ATOM_PREFIX = 'auth.'

/** `name` if it is one of {@link IDENTITY_METHODS}, else null. */
function identityMethodOf(name: string): IdentityMethod | null {
  return (IDENTITY_METHODS as readonly string[]).includes(name) ? (name as IdentityMethod) : null
}

/**
 * Which identity method an auth-provider atom id stands for.
 *
 * `'auth.password'` → `'password'`. The runtime atom `'auth'` → `null` (it is
 * the provider, not a way in), and so is any `auth.<name>` whose name is not in
 * {@link IDENTITY_METHODS} — the same closed list {@link classifyAtom} checks,
 * so an id this returns non-null for is exactly an id `classifyAtom` can
 * produce.
 *
 * WHY IT IS EXPORTED. A host turns a world's installed auth-provider rows
 * into the methods an app may use, and an app builder reads those methods
 * back. Both sides parsing `auth.` by hand is how the id convention and its
 * readers drift apart; the convention and its inverse live here together.
 */
export function identityMethodOfAtomId(id: string): IdentityMethod | null {
  if (!id.startsWith(AUTH_METHOD_ATOM_PREFIX)) return null
  return identityMethodOf(id.slice(AUTH_METHOD_ATOM_PREFIX.length))
}

// ============================================================
// ATOM REFERENCE
// ============================================================

/**
 * A reference to a single atom inside a pwpack source tree or installed workspace.
 *
 * `relPath` is the path inside the tgz / source directory (no leading slash).
 * Example: `blocks/control/button/component.tsx`,
 *          `capabilities/persistence/handler.ts`,
 *          `surfaces/marketing/hero.receipt.json`.
 *
 * `contentHash` is an optional sha256 (hex) for per-atom integrity verification
 * during install fan-out.
 *
 * `bundleUrl` + `bundleHash` are populated by the publish pipeline
 * for the bundled kinds ({@link isBundledKind} — `block`, `capability`,
 * `connector`, `provider`). `pwpack-publish-service` runs `atom-bundle-service`
 * (esbuild) and uploads the ESM bundle to the CDN at
 * `pwpacks/<slug>/<version>/bundles/<kind>/<atomId>.bundle.mjs`. The runtime
 * dynamic loader resolves these via `import(bundleUrl)` and verifies
 * `bundleHash`. Non-bundled kinds skip this step (JSON snapshots, no transform).
 *
 * `bundleSizeBytes` is the byte size of the emitted bundle, set by
 * the publish pipeline alongside `bundleUrl`/`bundleHash`, so storage-quota
 * accounting reads it off the contract shape.
 */
export interface AtomRef {
  readonly kind: AtomKind
  readonly id: string
  readonly relPath: string
  readonly version?: string
  readonly contentHash?: string
  readonly bundleUrl?: string
  readonly bundleHash?: string
  readonly bundleSizeBytes?: number
}

// ============================================================
// PWPACK MANIFEST
// ============================================================

/**
 * A pwpack manifest — the declarative inventory of atoms inside a pack.
 *
 * This is the canonical form. Historical `PwfPackManifest` (marketplace.ts)
 * is kept for back-compat and will be retired when all consumers migrate.
 *
 * `id` is the marketplace pack identifier: `@pwpack/<publisher>/<name>`.
 * `version` is the pack's semver.
 * `atoms` enumerates every installable artifact.
 * `contentHash` is the full sha256 of the tgz (for CDN integrity).
 * `storageRef` is the CDN-relative path (`pwpacks/<slug>/<version>/<sha256-prefix>.tgz`).
 */
export interface PwpackManifest {
  readonly id: string
  readonly version: string
  readonly atoms: readonly AtomRef[]
  readonly contentHash: string
  readonly storageRef: string
  readonly description?: string
  readonly homepage?: string
  /**
   * What this pack needs the PLATFORM to provide. Without it the manifest can
   * say what a pack CONTAINS but not what it DEPENDS ON, and the only contract
   * between a pack and the platform is CSS custom-property names inside block
   * source — strings nothing versions and nothing checks.
   *
   * The failure is silent: a pack whose blocks ask for a token the deployed
   * cascade does not emit gets nothing, falls through to its literals, and
   * renders at the wrong contrast without any error.
   */
  readonly requires?: PwpackRequirements
  /**
   * What the pack's publisher allows others to do with its atoms: `fork` —
   * copy an atom into another pack and change it; `redistribute` — publish
   * that fork. Read by the host's licence and delta gates and shown wherever
   * the pack is listed.
   *
   * ABSENT IS NOT "BOTH OFF". The type carries no default; the CONSUMER applies
   * its own defaults (for example: first-party packs `fork: true,
   * redistribute: true`, third-party packs `fork: false, redistribute: false`).
   */
  readonly license?: { readonly fork: boolean; readonly redistribute: boolean }
}

/**
 * TOKENS, NOT A VERSION NUMBER.
 *
 * A version is a proxy; the token is the thing itself. A pack does not really
 * need "contracts >= 1.2" — it needs `--pw-color-primary-ink` to exist. Asking
 * the question directly removes the semver arithmetic, the prerelease ordering
 * edge cases, and the hand-maintained version constant that would drift.
 *
 * List only the tokens whose ABSENCE would be wrong — not everything a block
 * references. A pack ships some of its own (icon glyphs, a heading scale), and
 * those are not the platform's to provide.
 */
export interface PwpackRequirements {
  /** `--pw-*` custom properties the platform cascade must emit. */
  readonly tokens?: readonly string[]
  /**
   * Other pwpacks this pack stands on. Installing this pack installs them
   * first. A pack can depend on a pack that is not installed yet: the install
   * resolves the closure (`resolvePackClosure` in ./pack-requires.ts) and
   * refuses a dependency nobody has published.
   *
   * Optional and additive. A manifest without it has no pack dependencies.
   * Validate with `PwpackRequirementsSchema` / `validatePwpackRequirements`.
   */
  readonly packs?: readonly PwpackPackRequirement[]
}

/**
 * One pack-level dependency: which pack, and which versions of it.
 *
 * `id` names the pack the way first-party pack manifests already write it:
 * the bare name (`records`) or the full id (`@pwpack/records`). Both name the
 * same pack — see `packRefKey` in ./pack-requires.ts.
 *
 * `range` is a semver range (`^2.0.0`, `~1.4`, `>=1.2.0 <3`, `1.x || 2.x`).
 */
export interface PwpackPackRequirement {
  readonly id: string
  readonly range: string
}

// ============================================================
// ATOM MANIFEST KNOWLEDGE
// ============================================================

/**
 * AI-readable knowledge attached to each block / capability atom.
 *
 * A 4-field distillation for atomic building blocks. A composer reads this
 * to pick the right atom without loading the bundle.
 *
 * - `purpose` — single sentence: what this atom does.
 * - `useCases` — concrete situations that should reach for it.
 * - `composesWith` — atom IDs that pair well (parent or child / partner
 *   capability). Use the same IDs as `AtomRef.id`
 *   (`<category>.<name>` for blocks, `platform/<name>` for capabilities).
 * - `antiPatterns` — when NOT to use it / common mistakes (suppresses
 *   hallucinated misuse).
 *
 * All four fields are required; an atom without knowledge cannot publish.
 */
export interface AtomManifestKnowledge {
  readonly purpose: string
  readonly useCases: readonly string[]
  readonly composesWith: readonly string[]
  readonly antiPatterns: readonly string[]
}

export const AtomManifestKnowledgeSchema = z
  .object({
    purpose: z.string().min(1, 'knowledge.purpose is required'),
    useCases: z.array(z.string().min(1)).min(1, 'knowledge.useCases must have at least one entry'),
    composesWith: z.array(z.string().min(1)),
    antiPatterns: z
      .array(z.string().min(1))
      .min(1, 'knowledge.antiPatterns must have at least one entry'),
    /**
     * The build detail that must NOT ride on every composer call.
     *
     * The four fields above are what the prose generator reads, so every word
     * in them is spent on every compose. A generator that writes a component
     * tends to put the whole build specification into `purpose`; this is
     * where that spec goes instead:
     * it stays with the atom it describes, for a human or a repair agent
     * reading the manifest, and costs nothing per call because no prose
     * generator reads it.
     *
     * Optional, and the object stays `.strict()` — this authorises exactly one
     * named field, not an open bag. No length cap here either: `purpose` is
     * capped by the pack's own integrity gate, which is where a token-budget
     * rule can see what it is budgeting.
     */
    implementation: z.string().optional(),
  })
  .strict()

// ============================================================
// ATOM MANIFEST CONFIG (capability config-schema)
// ============================================================

/**
 * serializable projection of a capability's `ConfigSchema`,
 * carried in the on-disk manifest so the pwpack is the full source of truth
 * for a capability's declarative facets — symmetric with how blocks ship their
 * build-derived `definition`. Only the data `fields` cross into the
 * manifest; `ConfigSchema.validate` / `applyDefaults` are functions and stay in
 * the runtime `handler.ts`, joined by atom `id`.
 *
 * Mirrors `ConfigFieldDefinition` (config-schema.ts) field-for-field. Present on
 * capability atoms once the build's `deriveCapabilityConfig` step has run; absent
 * on blocks, surfaces, appearance atoms, and legacy capability manifests.
 */
export interface AtomManifestConfigField {
  readonly key: string
  readonly type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'select'
    | 'multi-select'
    | 'url'
    | 'email'
    | 'json'
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly label: string
  readonly description?: string
  readonly group?: string
  readonly order?: number
  readonly sensitive?: boolean
  readonly options?: readonly {
    readonly value: string
    readonly label: string
    readonly description?: string
  }[]
  readonly constraints?: {
    readonly min?: number
    readonly max?: number
    readonly pattern?: string
    readonly patternMessage?: string
  }
}

export interface AtomManifestConfig {
  readonly fields: readonly AtomManifestConfigField[]
}

export const AtomManifestConfigFieldSchema = z
  .object({
    key: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'select', 'multi-select', 'url', 'email', 'json']),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    label: z.string().min(1),
    description: z.string().optional(),
    group: z.string().optional(),
    order: z.number().optional(),
    sensitive: z.boolean().optional(),
    options: z
      .array(
        z
          .object({
            value: z.string(),
            label: z.string(),
            description: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    constraints: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        pattern: z.string().optional(),
        patternMessage: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const AtomManifestConfigSchema = z
  .object({
    fields: z.array(AtomManifestConfigFieldSchema),
  })
  .strict()

// ============================================================
// CONNECTOR / PROVIDER SCOPE DECLARATION
// ============================================================

/**
 * One delegated OAuth permission a connector/provider atom requires.
 *
 * WHY THIS IS A RECORD AND NOT A STRING.
 *
 * Stated in prose, inside an atom's own `knowledge.configSchema` description
 * (e.g. *"permission: delegated Sites.Read.All is enough"*), three facts are
 * buried in a sentence and none is machine-readable: WHICH permission,
 * whether an ADMINISTRATOR of the identity provider's organisation must consent
 * to it, and WHY the atom needs it. Each
 * is a field here, because each has a consumer: the first builds the consent
 * request, the second warns before the user meets an opaque Microsoft error,
 * the third answers "why does this app want to read all my sites?" on the
 * canvas card.
 *
 * A DECLARATION IS NOT A GRANT. This says what an engine needs, never what a
 * user has allowed. An app builder holds no credentials and decides no
 * scopes; consent stays the user's, taken on the card. The declaration only
 * supplies the input that request never had: where the need came from.
 */
export interface AtomScopeDeclaration {
  /** The scope itself, verbatim as the provider spells it (`Sites.Read.All`). */
  readonly name: string
  /**
   * True when an administrator of the identity provider's organisation (in
   * Microsoft Entra terms, a tenant admin) must consent — the user cannot grant it
   * alone. Absent means "not stated", which is deliberately not the same as
   * `false`: an atom that has not been audited for admin consent should not
   * claim it needs none.
   */
  readonly adminConsent?: boolean
  /** Why this atom needs it. Shown on the card, in the user's words not ours. */
  readonly reason?: string
}

export const AtomScopeDeclarationSchema = z
  .object({
    name: z.string().min(1),
    adminConsent: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()

// ============================================================
// ATOM FILE MANIFEST (per-atom manifest.json on disk)
// ============================================================

/**
 * per-block authoring metadata serialized into the on-disk
 * manifest so the AI prose path can run without the runtime block registry.
 *
 * Shape mirrors `BlockDescriptor` (block-introspector) so the consumer can
 * round-trip into `CanonicalBlock` without bespoke transforms:
 * - `props` — descriptor list (each entry is a serialized `PropDescriptor`).
 * - `defaultProps` — values the composer uses when instantiating a block.
 * - `canHaveChildren` — composition rule for containers vs. leaves.
 * - `allowedParents` — optional whitelist of block IDs that may host this
 *   block as a child. Omitted means any container.
 *
 * Capabilities and surfaces do not carry this; the field is omitted on
 * non-block manifests and the schema marks it optional.
 */
export interface AtomBlockDefinitionMetadata {
  readonly props: readonly Record<string, unknown>[]
  readonly defaultProps: Readonly<Record<string, unknown>>
  readonly canHaveChildren: boolean
  readonly allowedParents?: readonly string[]
  /** palette/outline display glyph for the block. */
  readonly icon?: string
  /**
   * open trait vocabulary this block carries (kebab-case).
   * Containers restrict children by trait, so a third-party block joins a
   * slot (e.g. `form-field`) by self-declaration — no central list.
   */
  readonly traits?: readonly string[]
  /**
   * a child block passes if it carries ANY of these traits.
   * Only meaningful when `canHaveChildren` is true; omitted means the
   * container accepts any child.
   */
  readonly allowedChildTraits?: readonly string[]
}

const traitNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'trait names must be kebab-case')

export const AtomBlockDefinitionMetadataSchema = z
  .object({
    props: z.array(z.record(z.unknown())),
    defaultProps: z.record(z.unknown()),
    canHaveChildren: z.boolean(),
    allowedParents: z.array(z.string().min(1)).optional(),
    icon: z.string().optional(),
    traits: z.array(traitNameSchema).optional(),
    allowedChildTraits: z.array(traitNameSchema).optional(),
  })
  .strict()

/**
 * The on-disk shape of `pwpack-source/.../manifest.json` next to each
 * atom's source file. A publish pipeline parses these out of the tgz and the
 * install pipeline stores each with its atom.
 *
 * `category` is required for blocks and absent for capabilities. The permitted
 * values are NOT listed here: they are `BlockCategory` in
 * `@pwfabric/core`, and `BLOCK_CATEGORIES` is the array a
 * reader should consult. A list copied here would go stale, and nothing could
 * catch it: the schema below types this field as a plain string, so the prose
 * would be the only statement of the rule and no gate reads prose.
 *
 * The field stays `z.string()` deliberately. Narrowing it to an enum would put
 * the category list in the frozen root, and every new category would then be a
 * breaking change to the one package everything else depends on. Naming where
 * the truth lives costs nothing and cannot drift.
 *
 * `description` and `tags` are optional human-readable metadata used in the
 * marketplace UI; they do not replace `knowledge` (which is AI-targeted).
 *
 * `definition` is the BlockDefinition's authoring metadata
 * present on block atoms once the augment script has run; absent on
 * capabilities and legacy manifests. Server-side `assembleCanonicalRegistry`
 * can read this in lieu of a hardcoded runtime registry.
 *
 * `config` is the capability's build-derived config-schema
 * — present on capability atoms once `deriveCapabilityConfig` has run; absent
 * on blocks (which carry `definition`) and legacy capability manifests. The
 * host reads this in lieu of the runtime `platformCapabilities` registry.
 *
 * `theme` is the ui-appearance atom's PAYLOAD — the token
 * set itself. Appearance is a data atom: it ships no bundle, so the manifest is
 * the whole atom, and `useAvailableThemePresets()` reads `manifest.theme`
 * straight off the installed row. This schema is `.strict()`, so until the
 * field existed here every theme atom failed its own manifest contract while
 * the code that consumes them worked fine — the gap 's migration left.
 * Each payload field belongs to exactly one kind: `definition` to blocks,
 * `config` to capabilities, `theme` to ui-appearance, and — as of
 * `connection` / `configSchema` / `scopes` to connectors and providers.
 */
export interface AtomFileManifest {
  readonly id: string
  readonly kind: AtomKind
  readonly version: string
  readonly name: string
  readonly state: 'stable' | 'beta' | 'alpha' | 'deprecated' | 'experimental'
  readonly category?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly knowledge: AtomManifestKnowledge
  readonly definition?: AtomBlockDefinitionMetadata
  /**
   * capability config-schema, build-derived. Present on
   * capability atoms; absent on blocks (which carry `definition` instead) and
   * legacy manifests. Orthogonal to `definition`.
   */
  readonly config?: AtomManifestConfig
  /**
   * the ui-appearance atom's token set. Present on
   * ui-appearance atoms; absent on every other kind. Orthogonal to
   * `definition` and `config`.
   */
  readonly theme?: SurfaceTheme
  /**
   * The connection name this atom's engine binds to — the value
   * `connectors.name` is matched against. Connector and provider manifests
   * carry it and hosts read it; this schema is `.strict()`, so without the
   * declaration every one of those manifests would fail its own contract.
   */
  readonly connection?: string
  /**
   * The connection's config-schema. Same shape as a
   * capability's `config` — one definition of "what a config schema is" —
   * and, like `connection`, already present in production data
   * (a first-party connector's `sites.knowledge.json`) but undeclared until
   * this field existed.
   */
  readonly configSchema?: AtomManifestConfig
  /**
   * the delegated OAuth permissions this connector/provider needs.
   *
   * ABSENT MEANS "NEEDS NONE" — a positive statement, not a gap. The publish
   * gate is what separates it from "forgot to declare": a manifest whose prose
   * names a scope missing from this list fails to publish, so the sentence can
   * no longer be a second, unreadable source of truth.
   */
  readonly scopes?: readonly AtomScopeDeclaration[]
  /**
   * Where a forked atom came from. ABSENT MEANS
   * AN ORIGINAL ATOM. Present, it names the upstream pack id and version, the
   * upstream atom id, and the upstream source hash at fork time — what the
   * market's delta gate compares against and what a listing shows.
   */
  readonly forkedFrom?: {
    readonly pack: string
    readonly version: string
    readonly atomId: string
    readonly hash: string
  }
}

/** Schema twin of {@link AtomFileManifest.forkedFrom}. Module-private: the field ships as a type, not as a new schema export. */
const atomForkOriginSchema = z
  .object({
    pack: z.string().min(1),
    version: z.string().min(1),
    atomId: z.string().min(1),
    hash: z.string().min(1),
  })
  .strict()

/**
 * A connector atom DECLARES its engine instead of shipping
 * one.
 *
 * Once `HttpEntityConnector` carries the transport, what is left of a Graph
 * engine is seven lines of fact. A class holding them would be transport the
 * base already owns plus two value transforms — and a signature to get wrong
 * (one options object where the runtime passes two positional arguments is
 * enough to request `lists/undefined`). A declaration has no signature to get
 * wrong.
 *
 * NOTHING EXECUTABLE MAY APPEAR HERE, and that is the whole discipline. There
 * is no function, no expression, no template language. `transforms[].use` is a
 * NAME resolved against a CLOSED registry in the runtime; an unknown name is a
 * validation error, never a silent pass. A declaration that could carry a
 * function would be a class again with extra steps.
 *
 * NO CREDENTIAL EITHER. `auth` states the KIND only. Which identity, and its
 * live token, come from the running app at call time — the
 * same rule that keeps credentials out of a published bundle keeps them out of
 * a manifest.
 */
export const engineDeclarationSchema = z
  .object({
    /** Origin + version prefix, e.g. `graph.microsoft.com/v1.0`. */
    host: z.string().min(1),
    /**
     * Optional pre-flight: call `path`, take `field` from the answer, bind it
     * into the path template as `as`. Graph cannot address a list until the
     * site id is resolved, and declaring that step is precisely what stops it
     * from becoming an argument for an asynchronous base.
     */
    resolve: z
      .object({ path: z.string().min(1), field: z.string().min(1), as: z.string().min(1) })
      .strict()
      .optional(),
    /** Path template — `{entityType}` plus any binding named by `resolve.as`. */
    path: z.string().min(1),
    /** Fixed query parameters the API requires (e.g. `expand=fields`). */
    params: z.record(z.string()).optional(),
    auth: z.object({ type: z.enum(['bearer', 'api-key', 'basic', 'none']) }).strict(),
    read: z
      .object({
        /** Path to the array in the response body, e.g. `value`. */
        items: z.string().min(1),
        id: z.string().min(1),
        /** A nested bag whose keys are lifted to the row, e.g. `fields`. */
        flatten: z.string().min(1).optional(),
        /** Top-level keys to keep alongside the flattened bag. */
        lift: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    /** Write shape — e.g. Graph wants the row under `fields`. */
    write: z.object({ bodyWrap: z.string().min(1).optional() }).strict().optional(),
    /** Named value transforms, resolved against the runtime's closed registry. */
    transforms: z
      .array(z.object({ field: z.string().min(1), use: z.string().min(1) }).strict())
      .optional(),
  })
  .strict()

export type EngineDeclaration = z.infer<typeof engineDeclarationSchema>

export const AtomFileManifestSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ATOM_KINDS),
    version: z.string().min(1),
    name: z.string().min(1),
    state: z.enum(['stable', 'beta', 'alpha', 'deprecated', 'experimental']),
    category: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    knowledge: AtomManifestKnowledgeSchema,
    definition: AtomBlockDefinitionMetadataSchema.optional(),
    config: AtomManifestConfigSchema.optional(),
    theme: surfaceThemeSchema.optional(),
    // connector/provider payload. `connection` + `configSchema`
    // describe data already in production; `scopes` is the new declaration.
    connection: z.string().min(1).optional(),
    configSchema: AtomManifestConfigSchema.optional(),
    scopes: z.array(AtomScopeDeclarationSchema).optional(),
    // a connector atom may state its engine rather than
    // compile one. Absent, the atom behaves exactly as before.
    engine: engineDeclarationSchema.optional(),
    // Fork origin: absent = an original atom.
    forkedFrom: atomForkOriginSchema.optional(),
  })
  .strict()

export type AtomFileManifestInput = z.input<typeof AtomFileManifestSchema>
export type AtomFileManifestParsed = z.output<typeof AtomFileManifestSchema>
