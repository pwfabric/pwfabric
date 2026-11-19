# @pwfabric/runtime

## 3.1.0

- Added: `ConnectorEngineDescriptor.export`: the loader takes the engine factory from that named export, and fetches, verifies and evaluates a module once for every engine that names it.

## 3.0.1

- Changed: no engine words. `ui.loading` has no fallback, `createSkipLink` takes a required `label`, the retry control is named by the app's `ui.retry`, and `BlockErrorBoundary` draws no "Unknown error" title. `useAppMessage` and `messageOf` take an optional fallback (#61).
- Added: `SurfaceAuthState.pending`. While it is set, a `requiresSession` source is neither requested nor settled; it settles once the host knows who is signed in (#61).
- Fixed: a record page keeps its loading frame for the record and every source it fetches until the record arrives or the host replaces the page, so an unknown id goes to not-found without a layout shift (#61).

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- `{{__errors.<id>}}` is a code (`unauthenticated | forbidden | not_found | conflict | server | network | unconnected | error`), not a sentence. Forms and the `write` action write `statusKeys.reason` and `statusKeys.fields` instead of `statusKeys.message`; `statusKeys.detail` is for the developer (#49, #56).
- The forms validator and processor exports are removed (`createFormValidator`, `createFormProcessor`, `DEFAULT_VALIDATION_MESSAGES`, `validateWithZod` …) (#49).
- A failed source's `{{<id>}}` is always empty, also after a refresh or a poll; `EntityStore.query` rejects instead of answering an empty list. An `id eq` (or `notFoundWhenEmpty` `eq`) value that resolves to nothing makes the source idle (#51). An idle source is idle from the first render (#58).
- A block's props come from its manifest: the renderer applies the declared defaults and coercions (`applyBlockProps`); zod schemas moved to `@pwfabric/runtime/schemas` (#53).
- `style.maxWidth` no longer centres; write `margin: '0 auto'` (#51).
- The root no longer exports the Postgres connector (`/entity/postgres`), SEO (`/seo`), analytics (`/analytics`), Graph (`/graph`), perf (`/perf`) or the platform capability declarations (`/platform-capabilities`, also gone from `/capability`) (#55).
- `href: ""` is no longer a link to the entry page; write `/` (#56).
- `date(v)` writes `18 Nov 2026`; `time(v)` writes `14:30` with no seconds; a value that is not a date writes `''` (#56).
- Query values that read `{{me.*}}` are resolved; signed out, such a source is idle. Behaviors on a `repeat` row resolve `item` and `index`. A click dispatches the manifest's default `action` when the receipt sets none. `BlockContext.appHref` is required (#56).
- A source with `requiresSession` is not asked while nobody is signed in: no rows, `__errors.<id>` `unauthenticated`, `__errorCodes.<id>` `401` (#58).
- Every block sits in its own `Suspense` boundary inside its error boundary (#52).

### Other changes

- Added: `useAppMessage(id, fallback, vars)`, `AppMessagesContext`, `useAppMessages`, `formatMessage`, `messageOf`; the data gate reads `ui.loading` (#49).
- Added: `__auth` (`signedIn`, `user`, `methods`, `registration`, `error`) and `me` in the page scope; the `auth:signIn` / `auth:register` / `auth:signOut` actions, handed to the host's `identity.onAction` (#50).
- Added: `context.locale` (#52) and `context.appHref(path)` (#56) on every block; the helper `find(list, field, value)`; `date`/`time`/`datetime` take a style (`'short' | 'medium' | 'long' | 'full'`) (#56).
- Added: `BlockModuleLoader.register` and server rendering with hydration (#52).
- Changed: forms send the record's declared fields only, each as its type; a chosen file is refused before sending with the field named (#51, #56). A 409 is `reason: 'conflict'` with `fields` naming the unique key (#56).
- Changed: `initialState` expressions are evaluated once, when the first data pass settles; demo fallback rows are filtered only on fields they have (#51).
- Fixed: when the focused block is hidden by `visibleWhen`, focus moves to the region that appeared (#51).
- Fixed: the dev-only notice of `BlockErrorBoundary` names the declared props that did not fit when a block throws (#54).
- Fixed: the block loader's `fetch` matches the shell's preload, so each block module is requested once (#57).
- Fixed: a changed `initialState` reaches a mounted page, and not-found is reported only once the host address is known, so a hydrated record page loads the record from the address (#60).

## 2.2.0

- Changed (behaviour, apps and packs must act on it): **failure is a state, not sample data.** A source that fails for a real reason — a refused read (401/403), a not-found, a server error, a network failure, a connected engine that fails — binds **no rows**, whatever its `fallback` says. `fallback` is bound only when nothing is connected to serve the source (a connector the host did not register, no entity facade or records base), with the source's `query` applied, so an `?id=` detail never shows another record. This reverses 2.1.0's "a `rest` source that cannot be served binds its `fallback`". A page that showed sample data behind a refused read must branch on `__errorCodes.<id>`; a detail page that bound a fallback record must show its own not-found or error state.
- Added (minor): `{{__errorCodes.<id>}}` — why a source failed: the HTTP status as a number (`401`, `403`, `404`, `500` …), `"network"`, `"error"`, or `"unconnected"` (demo mode, the fallback is bound); `null` while the source is healthy.
- Changed: `{{__errors.<id>}}` is a sentence a visitor can read; the internal detail ("No entity facade available", "HTTP 500: Internal Server Error") goes to the console only. A form's and a `write` action's `statusKeys.message` is a visitor's sentence too ("Check the highlighted fields: email.", "You are not allowed to save this."); new `statusKeys.detail` carries the server's own words (`403 FORBIDDEN: You may not create Order records.`).
- Added: connector failures carry `code` (`ConnectorFailureCode`: the HTTP status, or `"network"`) on `ConnectorResult` and on the query and aggregate results.
- Added (minor): the `write` action — writes one record of a source (`op: "create" | "update" | "delete"`, `id`, `values`, resolved like the rest of the action) through the path a form uses: the entity facade for an `entity` source, otherwise `POST <endpoint>`, `PATCH <endpoint>/<id>`, `DELETE <endpoint>/<id>`. The server enforces the access rules; a successful write runs `refreshAll`; an update or delete without an `id` fails without sending anything. A `write` action's `sourceId` is not a read of the source.
- Fixed: a behavior's actions are resolved against the page scope when the event fires — a `navigate` url and a `setState` value read `{{state.x}}`, and a `navigate` url whose page is an expression is checked like a link from data. Actions carried in an event payload (a control's `stateKey`) are never evaluated.
- Added (minor): `formBindings[].successRedirect` is resolved after the write, against the page scope plus `result` (the written record): `/confirmation?id={{result.id}}`.
- Fixed: a write-only source is read only by an expression that names it (`{{orders}}`, `{{__errors.orders}}`) or by its exact id as a value. A nav link `/orders` made a checkout page list `Order` and log a 401.
- Added (minor): a surface `title` may carry expressions (`{{dish.0.name}}`); the resolved title is reported through the new `onTitle` render option (`undefined` while it resolves to nothing). A receipt `description` may carry expressions the same way, reported through `onDescription`; a template is never shown.
- Added (minor): the `locale` render option (BCP 47): `date()`, `time()`, `datetime()`, `currency()`, the new `number(n, decimals?)` and `n.toLocaleString()` write in it. Absent, the visitor's locale.
- Added (minor): `notFoundWhenEmpty` on a data source — when it settles with no record (a 404, no row, or not fetched because the path value it needs is empty) the page tells its host's address it is not found, and the host draws the app's not-found page at the same address. A refused read or a server error is not "not found"; it is the source's error state.
- Added (minor): the `address` render option (`SurfaceAddress`; `documentAddress()` and `SurfaceAddressContext` are exported) — the page's address as the host owns it: where a split shell's selection and `urlState` live, and where a page reports a missing record. Absent: the document's own query.
- Changed (behaviour, split-view blocks): a split shell's selection is read and written through the page's address — under the hash router the route's own query (`#/reference?endpoint=x`, pushed, so Back undoes it), no longer `location.search` beside the route — and it is page state, `{{state.<selectionKey>}}`. `useShellSelection(key, { fallback, ids })`: with `ids`, an address naming an unknown id is no selection (`undefined`, state `null`) instead of the fallback; the fallback applies only when the address names nothing.
- Added (minor): `urlState` in the persistence config — those keys are seeded from the address query and written back (`replaceState`) when they change; `''`/`null` removes the key, lists and objects are not written.
- Changed (behaviour, blocks): the block wrapper carries `data-block-id` and `data-block-wrapper` only, never `id` (every id was in the page twice). A block renders `id={block.id}` on its own root, as first-party blocks already do.
- Added (minor): block sizing `fill` (`BlockSizing`) — for a block with no content width (a progress bar, a rule): its wrapper fills the line in a column or centred parent instead of collapsing to zero. Fixed: an installed block's `sizing` reaches its wrapper once its module loads.
- Fixed: a link to the app's own media (`pwpack/media/<file>`) stays a relative file link, under both router modes and when its value comes from data (`{{item.receiptUrl}}` rendered a bare `<span>`). New exports: `isMediaLink`, `mediaLinkOf`, `MEDIA_PATH_PREFIX`.
- Fixed: the first render already has the window's breakpoint (`useViewport` started at `lg` and corrected itself in an effect, so a phone painted the desktop layout first — a layout shift of up to 0.5).
- Fixed: a `static` source is bound in the first frame, not one tick after the first paint.

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
