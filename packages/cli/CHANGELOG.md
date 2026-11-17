# @pwfabric/cli

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
