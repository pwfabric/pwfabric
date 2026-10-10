/**
 * Block Host Imports — what a dynamically loaded block may import, and what the
 * host must therefore provide.
 *
 * WHY THIS EXISTS. A published block is bundled per atom with esbuild and
 * loaded in the browser through `<script type="importmap">` + `import(blob:…)`.
 * Two kinds of import survive that: relative paths to files inside the block's
 * own pack, and a short list of BARE specifiers that are left unbundled for the
 * host to supply. That list appears in three places — the bundler's externals,
 * the host's import map and the shim files the host serves — and a specifier
 * missing from any one of them fails at load time ("Failed to resolve module
 * specifier" inside the blob module).
 *
 * This module is that contract, in one place, so the bundler's allowlist, the
 * host's import map and the shim files are all DERIVED and can be checked
 * against each other instead of drifting in silence.
 *
 * WHY NOT IN `@pwfabric/contracts`, where `dynamic-artifact.ts` already lives.
 * The contracts package is treated as immutable after release: every change to
 * its surface, even an additive one, goes through a stricter review. This list has to
 * change whenever a package joins or leaves the allowlist; putting it behind a
 * ceremony is what would recreate the drift it exists to prevent. It lives here,
 * where an additive export is an ordinary minor.
 *
 * @module @pwfabric/core/blocks/host-imports
 */

// ============================================================
// THE CONTRACT
// ============================================================

/**
 * How the host hands a shared module to a dynamically loaded block.
 *
 * `global` — the shim re-exports from `globalThis[global]`, which the host seeds
 * from its OWN bundled import. This is the mechanism for anything whose IDENTITY
 * must be shared: one React dispatcher, one event bus, one set of contract
 * values. Two instances of these is not "slightly wasteful", it is broken —
 * `useSurfaceEvents` reading a second context makes `emit()` a silent no-op.
 *
 * `inline` — HAS NO MEMBERS. `zod` in particular is NOT inline: on the publish
 * path it is external like everything else here, so blocks share the host's
 * single zod instance. Zod has its own identity stake — introspection keeps it
 * real so `instanceof` works while walking a schema. (A local authoring-tool
 * bundler may inline zod; that is a separate system.)
 *
 * Every specifier on THIS list is resolved by the host through a shim reading a
 * global; a specifier that is genuinely inlined is simply not external, and so
 * never reaches this list. The variant is kept only so the published type does
 * not change under consumers, and should go at the next major.
 */
export type HostImportKind = 'global' | 'inline'

/**
 * WHICH hosts seed a `global` entry. There are two of them and they are not
 * obliged to agree — recording that here keeps a derived gate from calling a
 * deliberate decision a gap.
 *
 * `every-host`  — both the app host and the standalone export's IIFE
 *                 (`@pwfabric/embed`'s `embed-global.ts`) must seed it.
 * `app-host`    — the app host seeds it; the standalone export deliberately
 *                 does NOT. The sdk global is the standing case: the authoring
 *                 kit is a development-time surface and does not belong in a
 *                 shipped app export, even though a published block's compiled
 *                 bundle may still call `defineBlock()` at module-load time.
 *                 Such a block works in the live canvas and degrades in a
 *                 standalone export, which is the chosen trade-off.
 * `unseeded`    — nothing seeds it yet. The specifier resolves (the shim is
 *                 served) but its named exports come back `undefined`. That is
 *                 strictly better than an unresolved bare specifier, which
 *                 fails the whole module at link time — but it is a gap, and
 *                 naming it here keeps it visible.
 */
export type HostSeeding = 'every-host' | 'app-host' | 'unseeded'

/** One specifier a block may import, and how the host satisfies it. */
export interface HostImport {
  /** The bare specifier as it appears in block source and in the bundle. */
  readonly specifier: string
  readonly kind: HostImportKind
  /**
   * The `globalThis` key the shim reads. Present for `kind: 'global'` only.
   * The host seeds it from its own bundled import of the same package.
   */
  readonly global?: string
  /** Which hosts seed {@link HostImport.global}. Present for `kind: 'global'` only. */
  readonly seeding?: HostSeeding
  /**
   * Shim file this specifier resolves to, relative to the host's shim directory.
   * SEVERAL SPECIFIERS MAY SHARE ONE FILE — `@pwfabric/runtime` and its
   * subpaths all resolve to the runtime shim, because what a block imports is
   * a runtime contract, not a package name.
   */
  readonly shim: string
  /** Why this specifier is on the list. Read by humans, not by code. */
  readonly reason: string
}

/**
 * THE LIST. Order is not significant; every consumer derives from the whole set.
 *
 * Adding an entry is the ONLY supported way to let blocks import something new.
 * The derivation helpers below mean a new entry reaches the bundler's allowlist,
 * every host's import map and every shim file together.
 */
export const BLOCK_HOST_IMPORTS: readonly HostImport[] = [
  {
    specifier: 'react',
    kind: 'global',
    global: '__pwfabric_react',
    seeding: 'every-host',
    shim: 'react.mjs',
    reason:
      'One dispatcher. A second React instance makes every hook in a block throw "Cannot read properties of null (reading \'useState\')".',
  },
  {
    specifier: 'react/jsx-runtime',
    kind: 'global',
    global: '__pwfabric_jsx_runtime',
    seeding: 'every-host',
    shim: 'react-jsx-runtime.mjs',
    reason:
      'The automatic JSX transform emits imports from here; it must be the same React. NOTE the global is `__pwfabric_jsx_runtime`, not `…_react_jsx_runtime`; the shim and the seeders read this name.',
  },
  {
    specifier: 'react-dom',
    kind: 'global',
    global: '__pwfabric_react_dom',
    seeding: 'unseeded',
    shim: 'react-dom.mjs',
    reason: 'Blocks that portal or measure reach for react-dom; same-instance rule as React.',
  },
  {
    specifier: '@pwfabric/runtime',
    kind: 'global',
    global: '__pwfabric_runtime',
    seeding: 'every-host',
    shim: 'runtime.mjs',
    reason:
      'Surface event bus, surface id and connections contexts. A block reading a second context emits into nothing.',
  },
  {
    specifier: '@pwfabric/runtime/data',
    kind: 'global',
    global: '__pwfabric_runtime',
    seeding: 'every-host',
    shim: 'runtime.mjs',
    reason:
      'A runtime subpath the package root re-exports WHOLESALE, so the root shim serves it exactly — the foundation pack persistence capability imports `createDataService` from here. An import map resolves exact specifiers only: without this entry the import would compile with a HOST_SUBPATH_IMPORT warning and then fail to resolve in the browser. Only subpaths whose every export the root also exports may join; the runtime package has a test that says so.',
  },
  {
    specifier: '@pwfabric/runtime/capability',
    kind: 'global',
    global: '__pwfabric_runtime',
    seeding: 'every-host',
    shim: 'runtime.mjs',
    reason:
      'A runtime subpath the package root re-exports WHOLESALE, so the root shim serves it exactly — capability atoms import their definition helpers from here. An import map resolves exact specifiers only: without this entry the import would compile with a HOST_SUBPATH_IMPORT warning and then fail to resolve in the browser. Only subpaths whose every export the root also exports may join; the runtime package has a test that says so.',
  },
  {
    specifier: '@pwfabric/runtime/adapters',
    kind: 'global',
    global: '__pwfabric_runtime',
    seeding: 'every-host',
    shim: 'runtime.mjs',
    reason:
      'A runtime subpath the package root re-exports WHOLESALE, so the root shim serves it exactly — image adapters; a block that renders a responsive image reaches for them here. An import map resolves exact specifiers only: without this entry the import would compile with a HOST_SUBPATH_IMPORT warning and then fail to resolve in the browser. Only subpaths whose every export the root also exports may join; the runtime package has a test that says so.',
  },
  {
    specifier: '@pwfabric/contracts',
    kind: 'global',
    global: '__pwfabric_contracts',
    seeding: 'every-host',
    shim: 'contracts.mjs',
    reason: 'Contract VALUES (enums, constants) must be the host’s, not a second copy.',
  },
  {
    specifier: '@pwfabric/core',
    kind: 'global',
    global: '__pwfabric_core',
    seeding: 'unseeded',
    shim: 'core.mjs',
    reason: 'Block layout helpers and breakpoint constants blocks resolve at render time.',
  },
  {
    specifier: '@pwfabric/authoring',
    kind: 'global',
    global: '__pwfabric_sdk',
    seeding: 'app-host',
    shim: 'sdk@v1.mjs',
    reason:
      'What the scaffolding emits and a third-party author reads first. A host that does not map it breaks every block that follows the documented path.',
  },
  {
    specifier: 'zod',
    kind: 'global',
    global: '__pwfabric_zod',
    seeding: 'every-host',
    shim: 'zod.mjs',
    reason:
      'Every block with a prop schema imports it as a value — 81 pack source files take `z`. Shared, not inlined: `zod.mjs` re-exports the host instance, and introspection depends on it being the real zod so `instanceof` holds while walking a schema.',
  },
] as const

// ============================================================
// DERIVATIONS — every consumer reads the list through one of these
// ============================================================

/**
 * The specifiers esbuild must leave bare when bundling an atom.
 *
 * A bundling service's externals list is exactly this. Note that `inline` kinds
 * are external TOO: the bundler leaves the specifier alone either way, and it is
 * the HOST that decides whether the name reaches a shared instance or a private
 * copy. Marking zod external here while the shim hands back a private module is
 * not a contradiction — it is the same distinction `kind` records.
 */
export function blockBundleExternals(): readonly string[] {
  return BLOCK_HOST_IMPORTS.map((i) => i.specifier)
}

/**
 * The host's `<script type="importmap">` payload.
 *
 * @param shimBase - URL prefix the shim files are served from, no trailing
 *   slash (for example `/_pwfabric/shims`).
 */
export function blockImportMap(shimBase: string): { readonly imports: Record<string, string> } {
  const imports: Record<string, string> = {}
  for (const entry of BLOCK_HOST_IMPORTS) {
    imports[entry.specifier] = `${shimBase}/${entry.shim}`
  }
  return { imports }
}

/** Every distinct shim file the import map can point at. */
export function blockShimFiles(): readonly string[] {
  return [...new Set(BLOCK_HOST_IMPORTS.map((i) => i.shim))].sort()
}

/**
 * The `globalThis` keys a host must seed before any block bundle is imported.
 *
 * A host that renders published blocks assigns each of these from its own
 * bundled import. Missing one does not throw where it is missing — it throws
 * inside a block, later, as an undefined named import.
 */
export function blockHostGlobals(host: 'app-host' | 'standalone' = 'app-host'): readonly string[] {
  // The standalone export is NOT the app host with fewer features — it seeds a
  // deliberately smaller set, and asking it for the app host's list would make a
  // gate demand the sdk global it deliberately leaves out. `unseeded`
  // entries belong to neither list: nothing seeds them today, and pretending
  // otherwise would turn a recorded gap into a failing gate nobody can satisfy.
  const wanted: readonly HostSeeding[] =
    host === 'standalone' ? ['every-host'] : ['every-host', 'app-host']
  return [
    ...new Set(
      BLOCK_HOST_IMPORTS.flatMap((i) =>
        i.global && i.seeding && wanted.includes(i.seeding) ? [i.global] : []
      )
    ),
  ].sort()
}

/** Entries whose global nothing seeds yet — a gap this list refuses to hide. */
export function unseededHostGlobals(): readonly HostImport[] {
  return BLOCK_HOST_IMPORTS.filter((i) => i.seeding === 'unseeded')
}

/**
 * Which specifiers resolve to a given shim file — the reverse of `shim`.
 * A shim generator needs this: one file serves every specifier aliased to it,
 * so it must export the union of what those specifiers' consumers import.
 */
export function specifiersForShim(shim: string): readonly string[] {
  return BLOCK_HOST_IMPORTS.filter((i) => i.shim === shim).map((i) => i.specifier)
}
