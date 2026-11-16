# @pwfabric/pack

## Unreleased

- Added (minor): `validatePack` checks the `pwpack.json` format 1.1 members `name`, `description`, `category` and `tokens`; a malformed one is an `IDENTITY_INVALID` error whose message names the member. They are accepted without a warning under `formatVersion` 1.0 too.
- Added: `deriveManifest` carries `description` into `PwpackManifest.description` and `tokens` into `PwpackManifest.requires.tokens`. `name` and `category` have no place in `PwpackManifest` and are not carried.
- Added: `checkBlockProps(app, catalog)` / `checkReceiptBlockProps(receipt, catalog, path)` report receipt block props that do not fit the block manifests' `definition.props[].jsonSchema`, as warnings: `BLOCK_PROP_UNKNOWN` (a prop the manifest does not declare), `BLOCK_PROP_ENUM` (a value outside the prop's `enum`/`const`), `BLOCK_PROP_TYPE` (a value of a JSON type the schema does not accept). `{{…}}` bindings are not checked. `blockPropsCatalog(sources)` builds the catalogue from manifests only (no block code runs); `blockTypeNames(id, manifest)` is the name rule a receipt's `type` resolves by.

## 2.0.0

- No changes; released with the other packages at 2.0.0.

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- `validatePack` reports app content (`APP_CONTENT_UNDECLARED`, `APP_CONTENT_INVALID`, `APP_CONTENT_ID`, `APP_CONTENT_UNREADABLE`), access rules (`APP_ACCESS_RULE`) and receipts the app does not serve (`APP_SURFACE_NOT_SERVED`).

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- No changes; version aligned with the family.

## 1.0.0-rc.1

- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
