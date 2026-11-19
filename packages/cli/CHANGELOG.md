# @pwfabric/cli

## 3.1.0

- Fixed: the page-hints script preloads an image only when a block marks it `priority: true` or it is an `image` block with `loading: "eager"`; a lazy image (the image block's default) is never preloaded.
- Added: a page's own theme. A receipt's `appearance` (`{ "use": "theme-<x>" }`, or a configuration) is resolved at build like the app's — the theme's light and dark tokens, the app's other members kept — and served in the receipt as `{ config }`; a page that wears exactly the app's appearance carries none. Its palette is in the theme stylesheet under `:root[data-pw-page="<key>"]`, the page-hints script names the page on `<html>` before the first paint, its webfonts are in the one webfont stylesheet with their stand-ins, and its first frame is painted in it. An unknown name is `THEME_NOT_FOUND` on the receipt.
- Changed: the facets of one provider ship in ONE module per vendor (`engines/<vendor>.<hash>.mjs`): each connection's entry in `engines/manifest.json` names it with the facet's `export`, so the vendor's shared code is no longer repeated per connection.
- Changed: served receipts (`pwpack/surfaces/*.receipt.json`) carry no `knowledge`; the source keeps it.
- Added: `pwf create --pack <name> [--id <pack id>] [--requires <folder|.pwpack>]` writes an empty pack folder: `pwpack.json` (`@pwpack/<name>`, `0.1.0`, `engines.pwfabric` the running engine's major), `README.md`, `atoms/README.md` and `.gitignore`. `--requires` caches, pins and requires the pack it stands on, as `pwf add` does.
- Added: `pwf add block <category>/<type> [--dir <project>]` writes `atoms/blocks/<category>/<type>/manifest.json` (no props yet, a `knowledge` skeleton) and a `component.tsx` that renders from its props and holds no words of its own, in a pack or an app folder. Names are kebab-case, 2–50 characters; a type the folder already has is refused. `pwf add <pack>` is unchanged; a pack folder named `block` is given as `./block`.
- Added: `@pwfabric/cli/authoring`, a light entry (no dev server, compiler or runner) with `createPack` and `addBlock` (the functions behind the two commands), `readProject` (a folder as `pwf validate` and `pwf pack` read it), `blockManifest`, `blockComponent`, `scaffoldNameProblem`, `PACK_ID` and `UsageError`, so a tool can scaffold and pack without running the binary. The package entry re-exports them.
- Fixed: `pwf validate` no longer reports `MESSAGES_MISSING` for a pack (a folder whose `pwpack.json` has no `app` member): a pack is not opened as an app.

## 3.0.1

- Changed: `pwf validate` reports `MESSAGES_MISSING` as an error, in every language and also for apps with no `plan.json`; `session.*` is asked for whenever the app has a password method, its own sign-in screen included. The `pwf create` starter writes `ui.retry` (#61).
- Added: `@pwfabric/cli/host` exports `authDeclarationOf` and `entityDeclarationsOf`; `RecordStore` takes `{ entities, seed, relationReadable, readOnly }`, so a host without the app folder on disk can use it (#61).
- Fixed: the app's own media (`/pwpack/media/*`) is served with `frame-ancestors 'self'`, so a page can embed its own PDF; pages keep `'none'` (#61).
- Fixed: under `pwf run`, a signed-out write answers 401 before the read-only refusal, as `pwf dev` does; a signed-in caller still gets `READ_ONLY` (#61).
- Fixed: the page-hints script preloads a deep link's frame only where the first-paint script uses it (#61).

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- **Shell format** (a host that serves or rewrites a build must follow): `pwf build` paints each page's first frame. The entry frame is in `<template id="pw-entry-frame">` and `#root` is empty; other pages are `pwpack/surfaces/<key>.html`; the shell carries `pw-first-paint` and `pw-page-hints` JSON and two more inline scripts, so `script-src` has three hashes; no static per-page preload links; boot.js carries no deep-link hints. Not painted: an app that requires sign-in, and `app.signIn` (#52, #57).
- The gateway session endpoint of `pwf dev` / `pwf run` answers a visitor with no session `200 { data: { signedIn: false } }`, not 401 (#57).
- `project.json` gains `messages`, `signInSurfaceId` and `identity.registration`; it has no `title` when the plan has none, and the shell has no `lang` when the plan has no locale (#49, #50, #57).
- The dev host's auth error codes: `method_unavailable` (was `provider_unavailable`), `invalid_state` (was `invalid_transaction`). Its principal answers carry `roles`. Registration follows `auth.json` `registration` (`403 REGISTRATION_CLOSED` / `INVITATION_REQUIRED`) (#49, #50).
- The record host is strict (types, `email`, bounds, `mustBe`, readable relations, `unique` → `409 CONFLICT`); a 409 message names each key field (#51, #56).
- `pwf validate` and `pwf build` refuse `ENGINE_RANGE_EXCLUDED`: an app or pinned pack whose `engines.pwfabric` excludes the running engine. `me` and `__*` are reserved source ids (`SOURCE_ID_RESERVED`). `frame-src 'self'` opens only for `.pdf` / `.txt`. `LocalHost` implementations add `reseed()` (#50, #51, #56).

### Other changes

- Added: `app/plan.json` `messages` copied into `project.json` (`MESSAGES_INVALID`); `pwf validate` `MESSAGES_MISSING`; `pwf create` writes `locale` and its `notFound.*` messages (#49, #56).
- Added: `pwf build` writes `fields` and `requiresSession` on own-records sources; the `ownerName` role (#50, #51, #58). `cli/host` exports `withRecordFields` and `withSessionSources`.
- Added: `pwf migrate blocks [dir] [--check] [--json]` — writes a block's props into its manifest from its zod schema and its code's fallbacks, and reports every disagreement (#53, #54).
- Added: `pwf build` checks every receipt's props (`BLOCK_PROP_*`), and `pwf validate` warns `STATUS_KEY_UNKNOWN` (#53, #56).
- Added: `pwf run` serves a sign-in app's local identity provider, br/gzip, and the build's `_headers` cache rules (#50, #51).
- Added: `pwf dev` reseeds the records when `app/content/`, `app/data/` or `entities.json` change, keeping the sessions (#56).
- Added: `pnpm check:hydration <app>…` (repository script): opens every painted page in a browser and fails on any hydration error or redrawn node (#57).
- Changed: `MESSAGES_MISSING` lists `auth.error.*` only when a provider or issuer can send the visitor back; the "unsupported provider, falling back to anonymous" line is gone (#56).

## 2.2.0

- Added: `pwf validate` (and `pwf pack`) warn `BLOCK_PROP_NOT_BINDABLE` about a `{{…}}` in a prop the block's manifest declares `bindable: false`, nested values included: since 2.1.0 the runtime leaves such a prop as written, so the mistake used to show only at render, as raw braces.
- Changed (behaviour, the record host): the `pwf dev` record host runs `prepareRecordWrite` (`@pwfabric/contracts`) on every create and update. A field the entity does not declare is refused; a field declared `server` is set by the host and a client value for it is refused; declared types are checked (new `enum` with `values`); a `required` field must have a value. One `400 VALIDATION_FAILED` lists every problem. **The owner-name heuristic is removed:** `ownerId`, `createdBy` and similar names no longer fill themselves — declare the owner field `server: "owner"`, and do not send fields the entity does not declare. `EntityField` carries `values` and `server`.
- Added (minor): `project.json` `locale`, written by `pwf dev`/`pwf build` from `app/plan.json` `locale`.
- Added (minor): an app's own not-found page — `pwpack.json` `app.notFound`: `pwf dev` and `pwf build` serve its receipt and write `project.json` `notFoundSurfaceId`.
- Added (minor): `pwf run <app>` (or `<app>/.pwf/out`) serves the app's records read-only — the same store and query path as `pwf dev`, the built receipts pointed at it; a create, update or delete is refused `403 READ_ONLY` with a sentence. `createLocalHost` takes `readOnly`.
- Changed: the dev record host lists rows in file order (seed order, then creation order; an update keeps the row's position); it no longer sorts them.
- Fixed: `pwf dev` and `pwf run` share one content-type table (csv, pdf, md, xml, ics, zip, audio, video, fonts); a path to a CSV is no longer answered with the app shell.
- Added: the app's policy carries `frame-src 'self'` when a page frames a document of its own media (`pwpack/media/*.pdf`, `.html`, `.htm`, `.txt`).
- Changed (behaviour, pwapp shell format — a host that serves or rewrites a build must act on it):
  - `seed.js` is gone: `embed.js` seeds every global.
  - The shell has no render-blocking script. The renderer is `<script async>` (none at all for an app behind a sign-in gate) and the runner loads it when it draws a page; the shell modulepreloads the runner and every shim and preloads the boot envelope files.
  - The runtime files are content-hashed: `assets/{embed,runner,boot,theme}.<hash8>.*`. Read their names from the shell; do not assume `assets/embed.js`.
  - `_headers` carries cache rules on disjoint paths: `/`, `/index.html`, `/shims/*`, the two manifests and `/pwpack/*` `no-cache`; `/assets/*`, `/blocks/*.mjs` and `/engines/*.mjs` `public, max-age=31536000, immutable`; `/pwpack/media/*` one hour. No source map ships to visitors.
  - `<meta name="description">` from `app/plan.json` `description` (new, optional) or the entry page's receipt `description`; `robots.txt` in the build.
  - A build whose identity has no `auth.json` writes `identity.door: false` in `project.json`.
  - Fonts: only the styles the theme draws (body weight plus 500/600/700, heading weight, mono regular, no italics); the stylesheet is preloaded and linked by the boot module; `theme.css` declares a metric-matched `"<Family> Fallback"` face and the theme stacks name it after each webfont.
- Added: `pwf run`'s `_headers` matcher takes a splat anywhere in a pattern (`/blocks/*.mjs`) and `! Name` (detach a header).

## 2.1.0

- Fixed: `pwf run` and `pwf dev` answer a page path that contains a dot (`/layout.two-pane`) with the app shell; only a path ending in a file type the server serves is an asset, and a missing asset of a known type is still a 404.
- Added (minor): `pwf build` and `pwf dev` add the origins a placed block declares (`definition.origins`) to the app's Content Security Policy, directive by directive; a block an app carries but no page places adds nothing, and a malformed declaration on a placed block fails the build.
- Changed: `blocks/manifest.json` carries each placed block's props with their `bindable` flag (`definition.props: [{ name, bindable? }]`), so the runtime can leave a `bindable: false` prop as written.
- Fixed: `pwf dev` reloads the page only when what it serves changed. A file the app does not read (a screenshot saved in the folder, an editor backup) no longer reloads the page and resets its state; `publishedAt` is fixed for the session.
- Added: `pwf validate` knows the row fields of a connector-served source from the entities its connector or provider declares (through `app/definitions/connections.json`), and reports `FIELD_UNKNOWN` for those too.
- Added (minor): `pwpack.json` is written with `name`, `description` and `category` after `formatVersion`, and `tokens` after `requires` (key order `id, version, formatVersion, name, description, category, engines, requires, tokens, license, app, packs`).
- Changed: `pwf create` writes `formatVersion` `1.1`.
- Added: `pwf validate` (and `pwf pack`) warn about block props in the receipts (`app/surfaces/*.receipt.json`) that do not fit the block's manifest: `BLOCK_PROP_UNKNOWN`, `BLOCK_PROP_ENUM` (names the allowed values), `BLOCK_PROP_TYPE`. Block types resolve as in `pwf dev`: the app's own blocks first, then its pinned packs from `.pwf/packs/`. A button with `size: "sm"` used to render as `medium` without a word.
- `pwf validate` and `pwf pack` report `FIELD_UNKNOWN` (a warning; the exit code does not change) for a receipt that reads a row field its data source's rows do not have, naming the surface, block, field, source and the known fields (data-protocol §2.4).

## 2.0.0

- No changes of its own; released with the other packages at 2.0.0. `pwf create` names `engines.pwfabric` `>=2.0 <3`.

## 1.2.0

- Added: `@pwfabric/cli/host`, a public entry for hosts other than `pwf dev`: `accessOf`, `parseRule`, `RecordStore`, `rewriteEntitySources`, `authAddresses`, `createLocalHost`, `readAuth`, `readEntities`, `readSeed`, `HostError`, `DEFAULT_DEV_USER`, `SESSION_COOKIE`, with their types (`Access`, `AccessVerb`, `AccessReach`, `Target`, `Caller`, `ListAnswer`, `AggregateAnswer`, `Scope`, `AuthDeclaration`, `EntityDeclaration`, `EntityField`, `Principal`, `LocalHost`, `LocalHostOptions`, `CreateLocalHost`). `pwf dev` imports the same entry.
- The envelope `auth.json` the local host writes states `apiBase` (every door, the external issuer included).
- Changed (stricter): once an app declares any access rule, a model no rule names is closed (`401`/`403`); an app with no rule stays open.
- Changed (stricter): a `count`-only grant answers the plain, unfiltered `/count` only; a filtered count and `/aggregate` need `list` and run over the rows `list` reaches.
- `pwf validate` and `pwf pack` report `ACCESS_RULE_MISSING` (an error) for every declared model no `access` rule names, including every model of an app with no `access` block; the message shows how to add a rule, with an explicit `public` rule for public data.

## 1.1.0

- The local host enforces the access rules of `auth.json` (`access.rules`): subjects `public`, `member` or a declared role; verbs `create`, `list`, `view`, `update`, `delete`, `count` (`read`, `write`); `own`. 401 without a session, 403 with one, 404 outside an `own` grant.
- `dev@localhost` signs in with every declared role; any other e-mail as a plain member. No password is checked.
- Collections are seeded from `app/content/` then `app/data/`.
- An `auth.json` holding only `access` is no identity: `project.json` carries none and no envelope `auth.json` is served.
- Envelope `auth.json` addresses are relative to the page.
- `pwf validate` also reports `SEED_INVALID`, `ENTITY_INVALID` and `ENTITY_UNDECLARED`.
- Removed: the draft entity `scope` and inferring owner collections from rule prose.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Changed (breaking): the local host offers the PhiWebs-account method as `phiwebs` (was `host`).
- `shimSource` and `isExportableName` moved to `@pwfabric/core`; `seed.js` no longer seeds `__pwfabric_sdk` (the renderer does).

## 1.0.0-rc.1

- `pwf --version` (and `-v`, `version`) prints the version.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
