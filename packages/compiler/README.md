# @pwfabric/compiler

The PWFabric atom compiler. A block's `component.tsx` (or a capability's
`handler.ts`, or a connector/provider engine) plus the companion files it
imports go in; one ES module the runtime can load comes out. The imports the
host provides — `react`, `zod`, the PWFabric packages; the list lives in
`@pwfabric/core` (`BLOCK_HOST_IMPORTS`) — stay external.

The compiler is pure: it works on an in-memory file map, writes nothing and
fetches nothing. Storing the bundle is the caller's job.

```ts
import { collectCompanions, compileAtom, screenSource } from '@pwfabric/compiler'

const files = {
  'atoms/blocks/content/greeting/component.tsx': source,
  'atoms/lib/format.ts': libSource,
}
const entry = 'atoms/blocks/content/greeting/component.tsx'

// Untrusted source? Screen the entry and every companion it reaches first.
const scan = collectCompanions(files, entry)
if (!scan.ok) throw new Error(scan.violations.join('\n'))

const result = await compileAtom({ files, entry, companions: scan.companions })
if (result.ok) {
  // result.code      — the ES module
  // result.hash      — 'sha256:…' of the code
  // result.externals — the host imports it needs
  // result.compilerVersion / result.esbuildVersion — record them with the hash
} else {
  console.error(result.diagnostics)
}
```

Same input and the same compiler and esbuild versions give the same bytes.

`compileFolder(dir, entry)` reads a tree from disk and calls `compileAtom`.

## What the compiler checks

- **Resolution is in memory.** Imports are resolved against the `files` map
  only, never the disk: a climb past the tree root is `PATH_ESCAPE` (a path is
  judged by where it resolves, not by whether it spells `..`), a missing file
  is `UNRESOLVED_IMPORT`.
- **Bare imports must be host imports.** A bare import outside the host import
  list is `NON_HOST_IMPORT`, listing the host imports. A subpath of a host
  import (`@pwfabric/runtime/auth`) compiles but carries a
  `HOST_SUBPATH_IMPORT` warning, because a host import map resolves exact
  specifiers only; subpaths that are on the list in their own right (`/data`,
  `/capability`, `/adapters`) compile without it.
- **Declared companions are enforced when given.** `companions` is optional;
  when it is passed, a relative import of any other file is `NOT_A_COMPANION`.
  Every file is keyed by its path from the tree root; `lib/` and `atoms/lib/`
  are both accepted.
- **The generated wrapper never overwrites a file.** A tree that already holds
  the wrapper's path is `INVALID_INPUT`.
- **Only script and JSON files load.** `.ts .mts .cts .tsx .js .mjs .cjs .jsx
  .json`; anything else (CSS, for instance) is `UNSUPPORTED_FILE`.
- **Source maps are opt-in and external.** `sourcemap: true` returns `map` and
  leaves `code` (and its hash) untouched — no `sourceMappingURL` comment.
- **Size is capped.** `MAX_ATOM_BUNDLE_BYTES` (500 KiB) unless `maxBytes` says
  otherwise; over it is `BUNDLE_TOO_LARGE`.
- **The screen's import allowlist is the host import list**, derived from
  `blockBundleExternals()`. The runtime hands a module classes that perform
  network requests, so the import layer does not narrow egress by itself; the
  escape scan and the host's sandbox do.

Storing the bundle, recording it, licence or permission checks, and deciding
which files of a pack are atoms are the caller's job.

## Security notes

**Screening is a hygiene check, not a security boundary.** `screenSource` is a
regex denylist over masked text. It catches the obvious spellings a model
emits; it does not stop aliasing a global through a binding
(`const g = globalThis; g['fe' + 'tch']`), `Reflect.get(globalThis, …)`,
`top[…]`/`parent[…]`, or an aliased `document` read by computed key. Four of
these are pinned as `it.fails` tests in `src/__tests__/screen.test.ts` so an
AST-based screener can flip them. Isolating untrusted block code (a separate
origin or sandboxed iframe/worker for block bundles, plus a Content Security
Policy) is the host's responsibility.

**Names written into generated source are validated and quoted.** The entry
wrappers embed the entry basename (block/capability) and the engine name
(connector/provider) in generated source, and both come from pack file and
folder names. So:

- `compileAtom` refuses an entry basename outside `[A-Za-z0-9_.-]` (or
  containing `..`) and an engine name outside `[A-Za-z0-9_-]` with
  `INVALID_INPUT`;
- `buildWrapperSource` re-checks and throws;
- every specifier, property key and message built from a name is emitted via
  `JSON.stringify`.

## Determinism

The compile is a pure function of the `files` contents, `entry`, options, this
package's version and esbuild's version. The `files` map order, the working
directory and the operating system do not enter the output. esbuild is pinned
to an exact version for that reason; `compilerVersion` and `esbuildVersion`
are returned with every result so a caller can record them beside the hash.

Licensed under the Business Source License 1.1 — see [LICENSE](./LICENSE).
