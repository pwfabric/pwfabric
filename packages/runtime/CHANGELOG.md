# @pwfabric/runtime

## 2.1.0

- Fixed: a link whose href is a whole expression (`{{item.url}}`) is rewritten for the router once its value is known (`linkHref` render option), instead of being taken for a page key. A resolved value is used only when it is a root-relative path, a `#` fragment or an http, https, mailto or tel URL; anything else — `javascript:`, `data:`, a value that is not a string — leaves the link without an href.
- Fixed: a behavior aimed at a block inside a `repeat` fires for every copy (`<id>--N`); a copy's own id still matches only that copy.
- Fixed: grid placement (`gridColumn`, `gridRow`, `gridArea`, also as breakpoint maps) goes on the grid item, the block's wrapper, not on its inner element.
- Fixed: a `rest` source that cannot be served (401, 403, 5xx, network) binds its `fallback`, with the error flag set, as data-protocol says.
- Fixed: `length(v)` is the length of a list or a string and 0 for anything else (`length(undefined)` was 9, `length(null)` 4).
- Fixed: a prop the block manifest declares `bindable: false` is left exactly as written — its `{{…}}` is not resolved (block-manifest). **First-party packs before foundation 9.0.0 marked props apps bind (`text.content`, `heading.text`, `link.href`…) `bindable: false`; move to the corrected packs together with this release.**
- Fixed: `createApiOutput` accepts `data` without `json` again, as in 1.x (zod 4 made the `z.unknown()` member required; it is now `.optional()`).

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.
- Form and surface validation report zod 4's messages (`Invalid input: expected number, received string`); a field path is joined from its keys as strings.

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- A static source's `query` (sort, filter) is applied, and re-applied when the page state it reads changes.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Fixed: a dynamic block that fails to load says so on the console (`[pwfabric] block "<type>" failed to load: <reason>`), not only in its on-page placeholder.
- Docs: an `entity` data source binds its records as a list under its id, `{{<id>}}` (comments said `{{data.<id>.items}}` / `.total`).

## 1.0.0-rc.1

- Removed: `DataCapability`, `DefaultDataCapability`, `createDataCapability` (use `DataServiceInterface`, `DataService`, `createDataService`); `EntityCapability`, `DefaultEntityCapability`, `createEntityCapability` (use `EntityFacade`, `DefaultEntityFacade`, `createEntityFacade`); `EntityBehavior`, `BehaviorEngine`, `DefaultBehaviorEngine`, `createBehaviorEngine` and the facade's `behaviors` accessor and option (use `EntityLifecycleHook`, `EntityLifecycleEngine`, `DefaultEntityLifecycleEngine`, `createEntityLifecycleEngine`, `entityLifecycle`) (deprecated).
- Themes no longer emit `--pw-color-surface`; use `--pw-color-card`.
- `zod` is a peer dependency (`^3.23.0`); `react` is a required peer (the main entry imports it); the unused `react-dom` and `next` peers are gone.
- Removed from the public API: `populateTestBlocks` and `TEST_BLOCK_DEFINITIONS` (`@pwfabric/runtime/blocks`); test fixtures and test setup files are no longer in the package.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
