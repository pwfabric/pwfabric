# @pwfabric/pack

## 3.6.0

- Added: `blockMessagesOf(manifest)` and `placedBlockWords(sources)`: the `ui.*` words a block manifest declares in `definition.messages`, and those the app's placed blocks read (pages and the layout), skipping a word whose replacing prop the receipt sets, or whose `when` prop (or its default) is off.

## 3.5.1

- Fixed: the theme's font families are read from the theme atoms too, for `FONT_FILES_MISSING`.

## 3.5.0

- Added: `svgUnsafeReason(bytes)`, one SVG screen by a strict parse and an allowlist: no DOCTYPE or entity, no processing instruction past the XML declaration, only SVG picture elements (no `script`, `foreignObject`, `image`, `feImage`, no prefixed element), no `on…` attribute, `href` only `#id`, `url()` only `url(#id)` in any attribute or style, no CSS escape, comment, loading function or `@import`, no animation of `href` or `on…`, no element inside `<style>`.
- Changed: a `public/*.svg` is judged by that screen (`APP_PUBLIC_SCRIPT`), and an SVG under `media/` that fails it is an error (`MEDIA_SVG_UNSAFE`, new) in `validatePack`, so `pwf validate`, `pwf add` and `pwf media add` agree.

## 3.4.0

- No changes; released with the other packages at 3.4.0.

## 3.3.1

- No changes; released with the other packages at 3.3.1.

## 3.3.0

- No changes; released with the other packages at 3.3.0.

## 3.2.0

- Added: `checkBlockTypes` (`UNKNOWN_BLOCK_TYPE`) and `checkBlockIds` (`BLOCK_ID_DUPLICATE`), the page checks `pwf validate` and `pwf build` share, with `definedBlockTypes`, `blockTypeFirstUses`, `unknownBlockTypeIssue` and `walkReceiptBlocks`.

## 3.1.0

- Added: `checkReceiptBlockProps` names a member of an array item or a nested object that the prop's `jsonSchema` does not declare (`BLOCK_PROP_UNKNOWN`, with its path — `blocks[0].props.columns[1].label` — and the nearest declared name when it looks misspelled), unless the schema leaves the object open. Template values stay unchecked; the names beside them are read. `nearestName` is exported.

## 3.0.1

- No changes; released with the other packages at 3.0.1.

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- A block (or any atom source) that imports `zod` no longer validates: `BLOCK_IMPORTS_ZOD`. `validateBlockProps` takes `manifests` (descriptors), not `schemas` (#53).

### Other changes

- Added: `BLOCK_PROP_SHAPE` (bounds, lengths, patterns, formats, nested members) and `BLOCK_PROP_DECLARATION` (a shape or default the runtime cannot read) (#53). A misfit value is reported as kept as written (#54).
- Added: `BLOCK_DEFAULT_COPY` and `ERROR_BOUND_AS_TEXT` warnings (`checkDefaultCopy`, `checkErrorsAsText`) (#49).
- Added: `pwpack.json` `app.signIn` (`APP_SIGN_IN_IS_A_ROUTE`) (#50).

## 2.2.0

- Added: `checkBlockProps` / `checkReceiptBlockProps` warn `BLOCK_PROP_NOT_BINDABLE` when a receipt puts a `{{…}}` template on a prop its block manifest declares `bindable: false` — anywhere in the value, nested lists and objects included. The runtime leaves such a prop as written, so the braces would render. The message names the block, the prop (with the path inside its value) and the template; a prop with no `bindable` declaration is bindable. A `bindable: false` value is now also checked against its schema as the literal it is (a template there is no longer skipped as a binding).
- Added: `isTemplate(value)` — whether a string is a template the runtime resolves; the runtime's own test, mirrored. `BlockPropDescriptor` carries `bindable`.
- Added: `validatePack` knows `pwpack.json` `app.notFound`: its receipt must exist like the entry's and the routes', it is not reported as a surface outside `surfaceOrder`, and listing it in `surfaceOrder` too is a warning (`APP_NOT_FOUND_IS_A_ROUTE`).

## 2.1.0

- Added: `validatePack` reports a malformed `definition.origins` on a block manifest (`BLOCK_ORIGIN_INVALID`).
- Added: `connectionFieldSets(app, sources)` — the known row fields of connector-served entities; `checkRowFields`, `checkReceiptRowFields` and `rowFieldSets` accept it.
- Added (minor): `validatePack` checks the `pwpack.json` format 1.1 members `name`, `description`, `category` and `tokens`; a malformed one is an `IDENTITY_INVALID` error whose message names the member. They are accepted without a warning under `formatVersion` 1.0 too.
- Added: `deriveManifest` carries `description` into `PwpackManifest.description` and `tokens` into `PwpackManifest.requires.tokens`. `name` and `category` have no place in `PwpackManifest` and are not carried.
- Added: `checkBlockProps(app, catalog)` / `checkReceiptBlockProps(receipt, catalog, path)` report receipt block props that do not fit the block manifests' `definition.props[].jsonSchema`, as warnings: `BLOCK_PROP_UNKNOWN` (a prop the manifest does not declare), `BLOCK_PROP_ENUM` (a value outside the prop's `enum`/`const`), `BLOCK_PROP_TYPE` (a value of a JSON type the schema does not accept). `{{…}}` bindings are not checked. `blockPropsCatalog(sources)` builds the catalogue from manifests only (no block code runs); `blockTypeNames(id, manifest)` is the name rule a receipt's `type` resolves by.
- Added: `checkRowFields(folder)` and `checkReceiptRowFields(receipt, entities, path, surface)` report `FIELD_UNKNOWN` (a warning) when an `app/surfaces/` receipt reads a row field its data source's rows do not have: `{{item.<f>}}` in a `repeat` over the source, a field-mapping prop (`*Field`, `*Key` except state keys, `columns[].key`) of a block given the rows whole, or `{{<src>.0.<f>}}`. Only sources with known fields are checked: an `entity` source (declared fields, its records' keys, the record envelope), `static` rows, and a `fallback` list. Also exported: `rowFieldSets`, `entityFieldSets`, `RECORD_ENVELOPE_FIELDS`.

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
