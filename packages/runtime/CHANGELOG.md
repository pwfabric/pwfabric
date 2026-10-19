# @pwfabric/runtime

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
