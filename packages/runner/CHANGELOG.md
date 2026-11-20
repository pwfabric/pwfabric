# @pwfabric/runner

## 3.2.0

- No changes; released with the other packages at 3.2.0.

## 3.1.0

- Fixed: an app with no way in (no `auth.json` method, no issuer) draws no session bar, so `pwf dev` no longer names `pill.region` as a missing message there. `mountSessionPill` takes `door`.
- Added: a page that names its own appearance wears it: the renderer is handed the receipt's `appearance` when it carries one, else the app's. `projectAppearanceRef` reads both (`appearance-ref.ts`). The runner names the page it draws on `<html data-pw-page>` (`PAGE_ATTR`) and removes it on its own not-found page.
- Added: an engine manifest entry's `export` reaches the engine loader, so a provider facet is built from its own export of its vendor's shared module.

## 3.0.1

- Changed: the runner draws no default words. `RUNNER_MESSAGES` and `NEUTRAL_MESSAGES` are removed; `RUNNER_MESSAGE_IDS`, `NO_MESSAGES`, `labelWith` and `RENDERER_MESSAGE_IDS` are exported. A message the app does not set is drawn empty, a control left without a name is named by its id, and `pwf dev` names each missing id in the console once (#61).
- Fixed: for an app with a way in, the first frame is marked `pending`: a `requiresSession` source stays loading until the session is known, so a signed-in visitor no longer sees the signed-out prompt first (#61).

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- `runApp({ locale })`, the Turkish runner copy, `RUNNER_COPY`, `copyFor`, `RunnerLocale`, `RunnerCopy` and `ProviderLabelKey` are removed; use `RUNNER_MESSAGES`, `runnerMessages`, `NEUTRAL_MESSAGES`, `RunnerMessages`, `RUNNER_MESSAGE_IDS`. Runner components take `messages` instead of `locale`. `applyGreeting` and `applyAuthToSurface` are removed. A refused sign-in shows `session.refused` (#49).
- `accountActionOf` / `AccountAction` are removed; `auth:*` actions reach the runner through the renderer's `identity.onAction`. `AccountControllerDeps.openGate` → `openSignIn(mode)`. A door without `registration: "open"` offers no sign-up (#50).
- `doorOf` and `declaresBridge` are removed; use `firstFrameDoorOf(project)` (#57).
- A page drawn into a static first paint is hydrated, not drawn again (#52, #57).

### Other changes

- Added: the app's own sign-in page (`project.json` `signInSurfaceId`), drawn inside the shell in front of a required app or when an `auth:*` action has nothing to send. The session bar is an `<aside>` landmark with 44 px buttons, drawn only when the app has no account control or sign-in page (#50).
- Added: `first-frame.ts` (`pageBlocksOf`, `pageSurfaceOf`, `firstFrameOptions`, `firstFrameAuthState`, `firstFrameLocale`, `firstFrameDoorOf`), shared with the build (#52, #57).
- Changed: `navigate` is followed through `router.follow`, as a link is; an empty `activeHref` marks no nav item (#51).
- Changed: the session probe treats an answer without a token as no session (#57). Own-records sources carry `requiresSession` (#58).
- Changed: block modules are preloaded once (`as="fetch"`); the runner skips modules already preloaded (#57).
- Fixed: a page painted at build takes the address (`?id=` and other keys) after hydration, so a record page opened at phone width loads its record instead of showing not-found (#60).

## 2.2.0

- Fixed: under the hash router, an in-page anchor (`href: "#rsvp"`, a button's `location.href = "#rsvp"`, a `navigate` to `#rsvp`) keeps the page in the address — `#/session?id=1#rsvp` — so a reload or a shared link lands on the same page at the anchor (it opened the entry page). A link click adds one history entry; `#` alone goes to the top of the page shown. Under the path router an anchor stays on the current path and query instead of resolving against `<base href>`. A jump within the page scrolls smoothly (instantly under `prefers-reduced-motion: reduce`).
- Added (minor): the page title follows a title with expressions (`onTitle`): `document.title` is the app title while the record loads or is missing, then `<App> — <Page>`. Likewise each page's `<meta name="description">` (`onDescription`); `PwappProject.description` is the app's own, used wherever a page states none.
- Added (minor): `PwappProject.locale` is passed to the renderer as `locale`.
- Added (minor): the app's own not-found page — `PwappProject.notFoundSurfaceId` — is drawn like any page, inside the app's shell, when the address names no page or a `notFoundWhenEmpty` source finds no record (same address). The runner's own not-found page is the fallback only.
- Added: a split shell's selection and the `urlState` keys are read from and written to the route's query (`#/reference?endpoint=x`), and the selection is seeded as page state.
- Fixed: a link to `pwpack/media/<file>` is not rewritten as a route; an anchor lookup falls back to `[data-block-id]`.
- Changed: the fallback session pill is a bar docked in the page flow after the app; it no longer covers content.
- Changed (behaviour, hosts that serve a pwapp must act on it): the runner loads the renderer itself, the first time it draws a page — `runApp({ renderer })`, default `'./assets/embed.js'`; a page that defines `window.PWFabric` already keeps its own. A visitor held at the sign-in gate never downloads it. `runner.js` has no static import of a shimmed specifier (link rules are bundled from `@pwfabric/runtime/render/links`; `createConnectorEngineRegistry` and `zod` are dynamic imports; the preview bridge checks its message shapes by hand). Before taking the previous page down it waits for the next page's block modules (`PWFabric.loadBlocks`).
- Changed: the runner asks for `pwpack/auth.json` only when `project.json` `identity.door` is not `false` (no more 404 for an app built without a sign-in host).
- Changed: `runner.js` is minified (119 KB → 86 KB) and ships no source map (`sourceMappingURL` stripped).

## 2.1.0

- Fixed: `rewriteHrefs` leaves a link that starts with an expression as written; `linkHrefFor(entry, toHref)` rewrites it once resolved, the same way.
- Changed (behaviour, changes the documented default): an `entity` data source with no `connector` reads the app's own records of its `entityType` (data-protocol §2.2). Until now the runner bound it to a connection named `graph-lists` (Microsoft SharePoint lists), contradicting the spec's examples and `pwf dev`. Now:
  - with the app's own API base known (`ownApiBaseOf(auth)`), the source is served from the record endpoints exactly as `pwf dev` serves it: `{ kind: "rest", method: "GET", endpoint: "<base>/records/<T>", authProviderRef: "<base>", returns: "data" }`, an aggregate at `/records/<T>/count` or `/records/<T>/aggregate?fn=&field=&filter=`;
  - without one, no facade is built for it and it draws its `fallback`.
  A connection — `graph-lists` included — serves a source only when the source (or its form binding) names it. An app that relied on the implicit `graph-lists` default must name `connector: "graph-lists"`.
- Added: `ownRecordsSource`, `ownRecordsCapabilities`, `ownRecordsReceipt` (the pure rewrite) are exported.

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.

## 1.2.0

- Fixed: a session from a provider sign-in (`startUrl` + `gatewaySessionUrl`, e.g. method `phiwebs`) is sent as `Authorization: Bearer` on the app's own record requests, as a password session always was. The app's API base is derived the same way for every sign-in method: `auth.json` `apiBase` when stated, else the first door address with its route removed (`loginUrl` − `/login`, … `startUrl` − `/_auth/start`, `gatewaySessionUrl` − `/_auth/session`). A ref that is not that base still gets no token.
- Fixed: a sign-in that comes back refused (`?auth_error=`, e.g. Cancel on the platform screen) is shown on an app that does not require sign-in too: the sign-in dialog opens with the message. It was shown only on a required app's wall.
- Added: optional `PwappAuth.apiBase`; `ownApiBaseOf(auth)` and `isOwnApiRef(ref, base)` are exported.

## 1.1.0

- A form binding's `successRedirect` and a `navigate` action's `url` are rewritten like hrefs, so a hash-routed app stays inside the app.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Added: `runApp({ version })` — every file read under `source` (the envelope JSON and the receipts) is asked for as `?v=<version>` (`&v=` after an existing query), so a page never mixes two publishes' files out of a cache. `withVersion(url, version)` is exported. Without `version`, nothing changes.
- Changed (breaking): the provider button for a PhiWebs account is `{ method: 'phiwebs' }` (was `host`): `PwappProviderButton.method`, `ProviderLabelKey` and `RunnerCopy.gate.providers.phiwebs` follow. It still stands first and still reads "Continue with your account".

## 1.0.0-rc.1

- Removed: `mountLoginButton` (deprecated; use `mountSessionPill`).
- Ships type declarations; `exports` lists `types`. `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
