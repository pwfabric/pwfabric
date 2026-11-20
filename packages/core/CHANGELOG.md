# @pwfabric/core

## 3.4.0

- No changes; released with the other packages at 3.4.0.

## 3.3.1

- No changes; released with the other packages at 3.3.1.

## 3.3.0

- No changes; released with the other packages at 3.3.0.

## 3.2.0

- No changes; released with the other packages at 3.2.0.

## 3.1.0

- No changes; released with the other packages at 3.1.0.

## 3.0.1

- No changes; released with the other packages at 3.0.1.

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- `BlockDefinition.schema` is gone; a block definition carries `props: BlockPropDescriptor[]` (#53).
- The root is zod-free: zod schemas (`blockLayoutSchema` …) moved to `@pwfabric/core/schemas` (#53).
- The root no longer exports the host-import table (`BLOCK_HOST_IMPORTS`, `blockImportMap`, `shimSource` …) → `@pwfabric/core/host-imports`; `defineConfigSchema` and its builders → `/config-schema`; `observe*`, `DEFAULT_BUDGET`, `createMetricsState`, `getRating` → `/monitoring`. `zod` is no longer a block host import (#53, #55).

## 2.2.0

- No changes; released with the other packages at 2.2.0.

## 2.1.0

- No changes; released with the other packages at 2.1.0.

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- No changes; released with the other packages at 1.1.0.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Added: `shimSource(shim, global, names)` and `isExportableName(name)` — the shim module source every host serving block bundles writes, so a host no longer copies it out of the CLI.
- Fixed: a shim never binds `undefined`, `NaN` or `Infinity` (zod exports `undefined`; `export const { undefined }` broke lint and some parsers).
- Fixed: `@pwfabric/authoring` (`__pwfabric_sdk`) is seeded by every host (`seeding: 'every-host'`, was `app-host`). A shim whose global every host must seed throws a readable error naming the global when it is missing, instead of a destructuring `TypeError`.

## 1.0.0-rc.1

- Removed: the `'inline'` member of `HostImportKind` (deprecated; it never had a member — every host import is `'global'`).
- `BlockDefinition.allowedChildren` is supported, no longer marked deprecated: which child block types a block accepts (`allowedChildTraits` is the trait-based alternative).
- `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
