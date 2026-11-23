# @pwfabric/cli

## Unreleased

- Added: a block manifest declares the `ui.*` words it reads of its own in `definition.messages` (`{ id, prop? }`, `prop` naming the prop that replaces the word). `pwf validate` reports each such word of a placed block (pages and the layout) that the app does not set as `MESSAGES_MISSING`, naming the block.
- Added: `pwf add connection <name> --origin <url> --auth bearer|api-key|basic|none` declares a connection to an outside API in `app/definitions/connections.json` (where it is and the kind of credential, never a credential), and with `--page`, `--source` and `--path` adds a page source that names it as its `connector`. The MCP server offers the same as `pwf_add_connection`.
- Fixed: `pwf dev` under hash routing sends a deep page path (`/reservation/`) to its hash address (`../#/reservation`), so the page's files resolve from the app root instead of 404 under the path.

## 3.5.1

- Fixed: `pwf run` never redirects off the site through a `_redirects` splat: leading slashes and backslashes are dropped from `:splat`, a control character redirects nowhere, and a filled-in target stays where its rule points. The build refuses `/:splat` targets.
- Fixed: `FONT_FILES_MISSING` checks the font families of the theme the app uses, theme atoms included.
- Fixed: a `pwf dev` preview can be shown in a frame (an editor, a hosted studio): `pwf dev` serves the build's Content-Security-Policy without `frame-ancestors`. `pwf run` and the built `_headers` keep it.

## 3.5.0

- Changed (upgrade note): `brand.favicon` is a media file (`media/<file>`), a file of `public/` or an `https://` address; anything else is `FAVICON_INVALID` in `pwf validate` and `pwf build`. The served form `pwpack/media/<file>` is refused with the file to write instead.
- Changed: `pwf validate` refuses a pinned pack that is not cached (`PIN_NOT_CACHED`, an error), as `pwf build` does, with the same fix.
- Added: app layouts, apps in several languages (per-locale documents, `hreflang`, one sitemap, llms sections, per-page words), `titleTemplate`, the colour-scheme script, `og:site_name`, `og:locale`, `twitter:card` and the icon link's `type`.
- Changed (upgrade note): fonts must be the app's own files: the webfont service is gone. Declare each family's WOFF2 files in the theme's `fonts`, most simply with the new `pwf font add <family> --from <path|https-url|npm:<package>>`; a family without files is drawn in its fallback (`FONT_FILES_MISSING`). The build serves them as `assets/fonts/<name>.<hash>.woff2`, with an `@font-face` per file, the body font preloaded and a metric-matched `"<Family> Fallback"`; `font-src` is `'self'` only.
- Note for apps on Foundation 2.0: the navbar has no `sticky` prop; use its block style (`position: sticky`, `top`, `zIndex`), and `alignSelf: "start"` in a stretched row.
- Added: `pwf media add <file|https-url>` puts an image in `media/` (PNG, JPEG, GIF, WebP, AVIF, SVG, told by its bytes; at most 20 MiB), records it in `media/provenance.json` and, in an app, declares it in `app/media/<key>.json` (`--alt`, `--source`, `--licence`, `--decorative`). An SVG must be a plain picture (`MEDIA_SVG_UNSAFE`, the screen of `@pwfabric/pack`). A downloaded address is recorded and printed as origin and path only; one with a user name or password is refused. Idempotent for the same bytes.
- Added: `pwf locale add <lang>` adds a language (the first add converts a single-language app: `defaultLocale` from `locale`, flat `messages` to `app/messages/<default>.json`; the new catalogue holds the default's ids, empty) and refuses one that breaks the address rules; `pwf locale status [--json]` lists per locale the missing and empty ids, translated addresses and per-locale receipts.
- Added: `pwf page add <key>` writes the page's receipt (empty, or from a pattern with `--pattern` and `--slot NAME=value`, applied as pattern-format §4 says), appends it to `app.surfaceOrder` (and to the plan's `surfaces` when the plan lists them), with `--title`, `--path <lang>=<segments>` and `--layout false`; a taken key, a served folder's name and an address conflict are refused.
- Added: `pwf upgrade [--check] [--from <build>]... [--to <id>@<version>]` reports, for each pinned pack with a newer build under `--from`, its engine-range fit, a new major, the blocks, props and patterns it drops with the receipts that use them, and its CHANGELOG between the versions; without `--check` it re-pins as `pwf add` does. pwf keeps no registry of versions.
- Added: `pwf check [out] [--links] [--weight] [--hydration]` on a built pwapp: broken internal links (files, page documents, hash routes, per-locale addresses, `_redirects`), each page's weight raw and gzipped against `--budget` (default 500 KB), and the hydration check in Chromium when Playwright is installed (an optional peer). Default: links and weight.
- Added: `pwf compare <old> <new>` lists the addresses of an older build the new one neither has nor redirects; exit 1 when any.
- Added: `pwf records import <type> <file.csv|json> [--replace]` and `pwf records export <type> [--format csv|json] [--out]` for `app/content/<type>.json`, typed and checked by `app/definitions/entities.json` (all or nothing); CSV is RFC 4180, and export guards formula-like cells.
- Added: `pwf doctor [--online] [--json]`: pwf, engine and Node versions, the folder's engine range and pinned packs with fixes for `PIN_NOT_CACHED` and `ENGINE_RANGE_EXCLUDED`, routing, languages, font files and the saved PhiWebs session (no network unless `--online`).
- Added: `pwf shoot [out] [--path]… [--widths] [--theme light,dark] [--locale] [--out]` writes full-page screenshots of a built app (needs Playwright).
- Added: `pwf publish --status [--project <id>]` shows whether the project's publish waits for approval (with the address to approve it), is online (with its address), or there is none.

## 3.4.0

- Added: `pwf build --router path|auto` writes one HTML document per page: `index.html` for the entry page, `<key>/index.html` for every other page, and `404.html` from the app's not-found page. Page links are written as `<base><key>/`. Page keys that name a served folder (`assets`, `blocks`, `engines`, `shims`, `pwpack`) are refused (`PAGE_KEY_RESERVED`).
- Added: each page's first frame is visible markup in the document at every width, not a `<template>` used only up to 639 px. What differs at wider breakpoints is a scoped `<style id="pw-static-layout">`. A block whose markup changes with width keeps its phone form until scripts run; the build reports it as `STATIC_PAINT_WIDTH` (info).
- Added: a per-page head: title, description and Open Graph tags; `canonical` and `og:url` from the new optional plan `origin`, `og:image` from the optional `image` (`ORIGIN_INVALID`, `IMAGE_INVALID`).
- Added: with an `origin`, `sitemap.xml` (every static page except record pages; none for an app that requires sign-in), a `Sitemap:` line in `robots.txt`, and `llms.txt` / `llms-full.txt` (llmstxt.org; chrome repeated on every page written once under "Site navigation").
- Changed: `pwf run` serves the per-page documents as a static host does, answers an unknown page with `404.html` and status 404, and serves the llms files as `text/plain`.

## 3.3.1

- Fixed: `pwf add @pwpack/<handle>/<name>` (and `pwf_add_pack` with a pack id) downloads a pack whose address PhiWebs gives on the API's own origin. That download now carries the session's `Authorization: Bearer` token, as `GET /api/pwpacks/sources` does; after a `401` the token is refreshed once and the download tried again. An address on any other origin (a presigned one) still gets no token. A plain-http address is refused unless the API itself is http (local development). A download the API refuses (`401`/`403`) fails with `SESSION_REFUSED` (run `pwf login`), one it does not find (`404`) with `PACK_NOT_INSTALLED`, any other with `PACK_DOWNLOAD_FAILED`; neither the address nor the token is printed. The listing's `expiresAt` is no longer expected.

## 3.3.0

- Added: `pwf run --cors <origin>` and `pwf dev --cors <origin>` (repeatable) answer cross-origin requests from the origins named, each one exact `scheme://host[:port]` (`*`, `null` and paths are refused). A request whose `Origin` is one of them gets `Access-Control-Allow-Origin: <that origin>`, and its preflight is answered with `204`: `GET, HEAD` for the app's files (granting only the cache and range headers it asks for), `GET, POST, PATCH, DELETE` under `/_host` (granting only `Content-Type`, `Authorization`, `X-App-Session`, `X-Pwapp-Request`). Every answer then says `Vary: Origin`; none ever says `Access-Control-Allow-Credentials`, so the local host's sign-in cookie never crosses origins, and its cookie addresses still require `x-pwapp-request: 1`. Under `--cors`, `pwf run` drops the `Access-Control-*` headers a build's `_headers` declares. Any other origin, and a run without `--cors`, is answered as before (`OPTIONS` is `405`).
- Added: a flag given more than once keeps every value in `ParsedArgs.lists` (`flags` keeps the last, as before).
- Added: the `pwf_describe_block {projectDir, type}` MCP tool (read-only). It finds the block a receipt's `type` resolves to — the folder's own blocks first, then its pinned packs, as `pwf dev` and `pwf build` resolve it — and answers, as text and `structuredContent`, the pack it comes from (`<id>@<version>`), its id and type, every prop descriptor as written (its `jsonSchema` with type, enum and bounds, `required`, `default`, `description`), `defaultProps`, `canHaveChildren`, its traits, and its whole `knowledge`. An unknown type is a tool error with `UNKNOWN_BLOCK_TYPE`, naming close matches. `pwf_describe_project` keeps its short list and points to it.
- Added: `pwf add @pwpack/<handle>/<name>[@<version>]` (and `pwf_add_pack` with that id as `pack`) adds a pack from the signed-in PhiWebs workspace. An argument that is a pack id and not an existing path is looked up in the API's `GET /api/pwpacks/sources` (scope `marketplace:read`, already asked for by `pwf login`); the pack is downloaded, its bytes checked against the sha256 PhiWebs gives, and installed exactly as a local `.pwpack` (same cache, pin and requirement). A pack PhiWebs skips is refused with the reason and what to do (`PACK_NOT_LICENSED`, `PACK_PATTERNS_ONLY`, `PACK_SOURCE_NOT_STORED`, `PACK_LISTING_MISSING`, `PACK_SOURCE_CHANGED`), one the workspace does not have with `PACK_NOT_INSTALLED`, a wrong hash with `PACK_HASH_MISMATCH`, and no session with `NOT_SIGNED_IN` (run `pwf login`). The download address is never printed. `pwf add` takes `--server`.
- Fixed: `pwf login` ends the session it replaces. Before a new login for a server with saved tokens, it revokes the saved refresh token (as `pwf logout` does) and deletes the tokens, so each re-login no longer leaves another "PWFabric CLI" connected app until it expires. A revocation that fails does not block the login; it is reported in one line.

## 3.2.0

- Added: `pwf mcp`, a local MCP server over stdio for any MCP client (Claude Code, Cursor, VS Code, Gemini CLI, …). Tools: `pwf_create_app`, `pwf_create_pack`, `pwf_add_pack`, `pwf_add_block`, `pwf_describe_project` (read-only), `pwf_validate`, `pwf_build`, `pwf_pack` — the commands' own functions. Every tool takes `projectDir` (absolute) and writes only inside it; answers end with the next step and carry `structuredContent`; failures are tool errors with a code and the fix. Tools only (no sampling, elicitation, subscriptions or progress), no account, no network, no dev server. The server is also the entry `@pwfabric/cli/mcp`, the only one that loads `@modelcontextprotocol/sdk` (1.32.2), imported on demand.
- Added: `pwf login [--server <url>] [--no-browser]`, `pwf logout` and `pwf whoami` sign in to PhiWebs (`https://api.phiwebs.com`, or `--server` / `PWF_PHIWEBS_URL`): OAuth 2.1 authorization code with PKCE, a loopback redirect on `127.0.0.1`, endpoints from `/.well-known/oauth-authorization-server`, dynamic client registration remembered per server. Tokens are saved in the user's config folder (`%APPDATA%\pwfabric`, `$XDG_CONFIG_HOME/pwfabric` or `~/.config/pwfabric`), readable by the user only, and refreshed when they expire. No other command needs an account.
- Changed (internal): the commands' work is factored into functions that return results instead of printing, which the MCP tools call (`createApp`, `addPack`, `buildProject`, `packProject`); a reported failure carries a stable code (`CommandFailure`). Output and exit codes are unchanged.
- Fixed: `pwf validate` refuses a block type that neither the app nor a pinned pack defines (`UNKNOWN_BLOCK_TYPE`, an error), with the code and words `pwf build` uses: both now call the same check in `@pwfabric/pack`. It is not judged while a pinned pack is not cached.
- Added: a block id used twice on one page, nested blocks included, is an error in `pwf validate` and `pwf build` (`BLOCK_ID_DUPLICATE`, naming both paths).
- Fixed: `pwf run` never answers an address under `/_host` with `index.html`. Without a record host (a copied build, a `.pwapp`) it is a `404` with a JSON error, `NO_RECORD_HOST`, saying to serve the app folder or use `pwf dev`; a host address the host does not serve is a JSON `404` too.
- Added: `pwf build --router <hash|path|auto>` (default `hash`) and `--base <path>`: `boot.js` passes the router to `runApp()`, and for `path`/`auto` the shell carries `<base href>` (and, for `auto`, `<meta name="pw-router" content="path">`). The first-paint and page-hints scripts read the page off the path under path routing, so a deep link paints its own page.
- Fixed: a nested page path answered by `pwf run` or `pwf dev` no longer gets a second `<base>` when the shell already has one.
- Fixed: under `pwf dev`, a file of the app the local host cannot read (a JSON syntax error in `auth.json`, `entities.json`, a receipt, a seed) is reported as `JSON_INVALID <file>` (or `FILE_INVALID`), not `INTERNAL` with a stack trace. An engine error prints its message only; `pwf dev --debug` adds the stack. The "Build failed" page also prints its errors in the browser console.
- Changed: the build line names the atoms it did not compile and why: `56/57 atoms compiled (… ; 1 skipped: RestConnector (connector declared as data, no code to compile))`.

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
