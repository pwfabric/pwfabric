# @pwfabric/core

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
