# @pwfabric/compiler

## 3.3.0

- No changes; released with the other packages at 3.3.0.

## 3.2.0

- No changes; released with the other packages at 3.2.0.

## 3.1.0

- Added: `compileAtom({ kind: 'provider', engineNames })` compiles several facets of one vendor into one module, entry `providers/<vendor>/__engines__.ts`, each facet's factory a named export under its name; `providerBundleSource` and `providerFacetEntry` are exported.

## 3.0.1

- No changes; released with the other packages at 3.0.1.

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- A block that imports `zod` fails to compile (`ZOD_IMPORT`) (#53).

### Other changes

- Added: `toCommonJs`, used by the build's static first paint (#52).
- Changed: the block wrapper recognises a definition without `schema` (#53).

## 2.2.0

- No changes; released with the other packages at 2.2.0.

## 2.1.0

- No changes; released with the other packages at 2.1.0.

## 2.0.0

- Security: `esbuild` 0.25.12 → 0.28.2 (advisories against its development server; the compiler uses only the build API).

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- No changes; released with the other packages at 1.1.0.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Fixed: a block module that exports only a `defineBlock()` definition resolves its component from `definition.component`; before, the loader found no component and the block did not render.

## 1.0.0-rc.1

- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
