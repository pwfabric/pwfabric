# pwf

The PWFabric command line. It creates, checks, packs and serves PWFabric apps
using only the engine's own packages, with no account and no network. `pwf mcp`
serves the same work to AI coding tools over MCP. `pwf publish` puts an app
online (or a pack in the marketplace) on [PhiWebs](https://phiwebs.com), the
platform PWFabric was built for, once `pwf login` has signed in; every other
command needs no account.

```sh
pwf create my-shop --foundation ./foundation   # a new app folder
cd my-shop
pwf validate                                   # check it
pwf pack                                       # write my-shop-0.1.0.pwpack
pwf add ../cards-2.1.0.pwpack                  # install and pin another pack
pwf create --pack cards                        # a new, empty pack folder
pwf add block content/price-tag                # a new block in a pack or app
pwf add connection shop --origin https://api.example.com --auth bearer  # an outside API
pwf run ./dist-app                             # serve a built pwapp
pwf mcp                                        # MCP server for AI coding tools (stdio)
pwf login                                      # sign in to PhiWebs (whoami, logout)
pwf publish                                    # publish the app on PhiWebs, print its address
```

Every command prints `--help`. Exit codes: `0` success, `1` failure (invalid
pack, missing file, refused write), `2` wrong usage.

## The project folder

`pwf create` writes a canonical pwpack folder (see the pwpack format in the
PWFabric specification):

```text
my-shop/
├── pwpack.json                      id @pwpack/local/my-shop, 0.1.0, pins the foundation
├── app/
│   ├── plan.json
│   ├── definitions/appearance.json  uses one of the foundation's themes
│   ├── definitions/navigation.json
│   └── surfaces/home.receipt.json   a heading, a text and a button from the foundation
├── atoms/README.md                  your own blocks go here (the README is never packed)
├── .gitignore                       .pwf/ and *.pwpack
└── .pwf/packs/<id>@<version>/       local copies of the pinned packs
```

`pwpack.json` members are always written in the order `id`, `version`,
`formatVersion`, `engines`, `requires`, `license`, `app`, `packs`, with
two-space indentation.

## Commands

### `pwf create <name> [--dir <path>] [--foundation <folder|.pwpack>] [--force]`

Creates the folder above. Every app stands on a foundation pack; it is not
published to a registry yet, so give its folder or `.pwpack` with
`--foundation`, or set `PWF_FOUNDATION` once. The foundation's pack content
(not its tooling — `package.json`, `scripts/`, tests) is copied into
`.pwf/packs/` and pinned by its content hash, so later commands work offline.
`engines.pwfabric` covers the engine version `pwf` was installed with, up to
the next major. A folder that is not empty is refused unless `--force` is
given (existing files are kept, generated ones overwritten).

### `pwf create --pack <name> [--dir <path>] [--id <pack id>] [--requires <folder|.pwpack>] [--force]`

Creates an empty pack folder: `pwpack.json` (id `@pwpack/<name>` unless `--id`
is given, version `0.1.0`, `engines.pwfabric` this engine's major, `requires`
empty), `README.md`, `atoms/README.md` and `.gitignore`. No block is written;
add one with `pwf add block`. `--requires` names a pack this one stands on: it
is cached, pinned and required as `pwf add` does. The name is kebab-case, 2–50
characters, starting with a letter.

### `pwf validate [dir] [--json]`

Reads the folder, runs the pack validator and prints its findings grouped as
errors, warnings and notes, with the path each one is about. It also checks
every `packs[]` pin against `.pwf/packs/<id>@<version>/`: a pinned build that
is not there is a warning (`PIN_NOT_CACHED`), one whose content hash differs is
an error (`PIN_HASH_MISMATCH`). Exit `1` on any error. `--json` prints the raw
result.

### `pwf pack [dir] [--out <file>]`

Validates (and refuses on errors), then writes the deterministic archive
`<name>-<version>.pwpack` into the folder, or to `--out`. Prints the path, its
size and the content hash. The archive holds the pack content only —
`pwpack.json`, `LICENSE`, `NOTICE`, `README.md`, `app/`, `atoms/` and `media/`
(pwpack-format §1.2) — so `.pwf/`, `.gitignore`, earlier `.pwpack` files and
the author's tooling are never included, and the folder and its archive hash
the same. Markdown notes under `atoms/` (such as the `atoms/README.md` that
`create` writes) are documentation and travel with the pack. The same folder
always gives the same bytes.

### `pwf add <path-to.pwpack|dir|@pwpack/<handle>/<name>[@<version>]> [--dir <project>]`

Validates the pack, copies its pack content to `.pwf/packs/<id>@<version>/`,
pins it in `packs[]` by the content hash of exactly what was copied and adds `{ id, range: "^<major>.0.0" }` to
`requires` (replacing an earlier entry for the same id). A pack id that is not
an existing path is a pack of the PhiWebs workspace you are signed in to
(`pwf login`): pwf downloads it, checks it against the sha256 PhiWebs gives and
installs it the same way; a pack PhiWebs keeps to its studio (a pattern pack,
a licence without the source) is refused with the reason. Resolving packs from
npm is not supported.

### `pwf add block <category>/<type> [--dir <project>]`

Writes a new block into the pack or app folder: `atoms/blocks/<category>/<type>/manifest.json`
(id `<category>.<type>`, state `experimental`, no props yet, a `knowledge`
skeleton to fill in before publishing) and `component.tsx` (renders from its
props and holds no words of its own: the app writes every word). Both names are
kebab-case, 2–50 characters, starting with a letter; a type the folder already
has is refused. The word `block` is the subcommand, so a pack folder named
`block` is added as `pwf add ./block`.

### `pwf add connection <name> --origin <url> --auth <bearer|api-key|basic|none> [--header <name>] [--items <path>] [--id <field>] [--page <key> --source <id> --path </collection>]`

Declares a connection to an outside API in `app/definitions/connections.json`
(`connector: "rest"`, `config: { baseUrl, itemsPath, idField }` and an engine
declaration `{ host: "{baseUrl}", path: "/{entityType}", auth: { type }, read }`).
It states where the API is and the kind of credential it takes, never a
credential: an origin with a user name, a password or a query is refused
(`CONNECTION_SECRET`), and `--header` (api-key only) is printed for the host
that stores the key, not written. With `--page`, `--source` and `--path` it also
adds to the page the source `{ id, kind: "entity", entityType, connector: <name> }`.

### `pwf dev [dir] [--port <n>] [--host <name>] [--router <mode>] [--base <path>] [--local-host | --no-host]`

Assembles the app in memory, serves it on `http://127.0.0.1:4600/` (`--port 0`
picks a free port), rebuilds on every change and reloads the page. While a
build has errors the page shows them, and so does the terminal.

`--router` and `--base` build the app as `pwf build` does, and the app is
served under that base. Every address is answered as `pwf run` answers the
same build (page documents, `404.html` with status 404, the `_headers` of the
build), except that nothing is cached.

When the app declares sign-in (`app/definitions/auth.json`) or records
(`app/definitions/entities.json`), `pwf dev` mounts the **local host** under
`/_host` on the same server: the session protocol (password door, provider
round trip, an issuer stand-in for an external topology) and the record
endpoints of the data protocol, with records in memory seeded from
`app/data/<Entity>.json`. The envelope then carries the host's `auth.json`, and
its receipts — entity sources rewritten to `rest` sources against
`/_host/records/<Entity>` — replace the folder's copies. `--local-host` mounts
it for an app that declares neither; `--no-host` serves the pages alone. The
local host is for development only: no password is checked, nothing survives
a restart. It enforces the app's access rules (`auth.json` `access`): the
development e-mail `dev@localhost` signs in with every declared role, any
other e-mail as a plain member, so each visitor can be tried.

### `pwf build [dir] [--out <dir>]`

Assembles the app into a static pwapp folder (default `<dir>/.pwf/out/`) for
`pwf run` or any static host. The folder carries the app's Content Security
Policy, derived from what the app declares (pwapp-format §2.1): as a `<meta>`
in `index.html`, as `_headers`, and as `publish.json` `csp`.

### `pwf run <dir|file.pwapp> [--port <n>] [--host <name>]`

Serves a built pwapp (any folder with an `index.html`, or a `.pwapp` archive
opened in memory) on `http://127.0.0.1:4700/` by default; `--port 0` picks a
free port. It answers as a static host does: a page's own document
(`<page>/index.html`) at its address, `404.html` with status 404 where no page
is, and `index.html` for a page path in a folder without `404.html` (hash
routing, or a build from before 3.4); a missing asset is a 404. Headers the folder's
`_headers` file declares (the app's policy) are sent with matching files.
Stop it with Ctrl-C.

### `pwf mcp`

A local MCP server on stdin/stdout for any MCP client (Claude Code, Cursor, VS
Code, Gemini CLI, …): `npx -y @pwfabric/cli mcp` as the server command. Tools:
`pwf_create_app`, `pwf_create_pack`, `pwf_add_pack`, `pwf_add_block`, `pwf_add_connection`,
`pwf_describe_project` and `pwf_describe_block` (read-only), `pwf_validate`, `pwf_build`, `pwf_pack` —
the same functions as the commands. Every tool takes `projectDir`, an absolute
path, and writes only inside it; answers end with the next step, failures carry
a code and the fix. No account, no network, no dev server (run `pwf dev`).
Signed in (`pwf login`), it also lists the PhiWebs studio's tools and forwards
their calls; signed out, `phiwebs_sign_in` explains how to sign in.
`pwf_publish_pack` publishes a pack folder to the marketplace (signed in).
`--local-only` serves the local tools only. Client configuration: see the CLI page on [pwfabric.com](https://pwfabric.com/cli#pwf-mcp).

### `pwf publish [dir] [--project <id>] [--new]`

An app: packs it, imports the `.pwpack` into a PhiWebs studio project (new,
or the one remembered in `.pwf/phiwebs.json`), publishes it and prints the
address. When the studio holds the publish for a person's approval (`202`,
`awaiting_approval`), it prints the address to approve it instead and exits
`0`; nothing is online until it is approved. A pack: sends it to the PhiWebs marketplace for review as the
workspace's publisher, under its own id. Findings and refusals carry their
codes and fixes. Needs `pwf login`.

### `pwf login [--server <url>] [--studio <url>] [--studio-url <url>] [--no-browser]`, `pwf logout`, `pwf whoami`

Sign in to PhiWebs with OAuth 2.1 (authorization code + PKCE, a loopback
redirect on `127.0.0.1`, dynamic client registration), for two resources: the
API and the studio, each with its own token. The server is
`https://api.phiwebs.com` unless `--server` or `PWF_PHIWEBS_URL` names
another; the studio resource (token audience, `<resource>/mcp`) is `--studio`,
`PWF_PHIWEBS_STUDIO_URL`, the one the API names, or `https://mcp.phiwebs.com`;
the studio's web address (`/s/*`, what `pwf publish` calls) is `--studio-url`,
`PWF_PHIWEBS_STUDIO_WEB`, the one the API names (`studio_url`), or
`https://studio.phiwebs.com` (another resource: its own address). Every
login registers a new client and first revokes and deletes the session it
replaces (a failed revocation does not stop it). A session from an earlier `pwf` gains
its studio token by signing in again. Tokens live in `%APPDATA%\pwfabric` (Windows) or
`$XDG_CONFIG_HOME/pwfabric` / `~/.config/pwfabric`, readable by the user only,
and are refreshed when they expire. `logout` revokes (when the server can) and
deletes them; `whoami` prints the account and workspace, or exits 1 when not
signed in.

### `pwf media add <file|https-url> [--name <file>] [--alt <text>] [--source <url|generated|uploaded|provided>] [--licence <id>]`

Puts an image into `media/`: PNG, JPEG, GIF, WebP, AVIF or SVG, told by its
bytes (an extension that disagrees is `MEDIA_TYPE_MISMATCH`), at most 20 MiB.
An SVG must be a plain picture: it is parsed, and script, `foreignObject`,
`image`, an `on…` attribute, an `href` that is not `#id`, a `url()` that is
not `url(#id)`, a DOCTYPE or entity and CSS that loads anything are refused
(`MEDIA_SVG_UNSAFE`) — the screen `pwf validate` applies to `media/` and
`public/` SVGs. Records the file in `media/provenance.json` (`path`, `hash`,
`source`, `createdAt`, `license`, `origin`) and, in an app, declares it in
`app/media/<key>.json` (`--alt` is its `purpose`). A downloaded address is
recorded as origin and path only (its query, where a signed address keeps a
token, is dropped); an address with a user name or password is refused. The
same bytes again change nothing; other bytes under a taken name are refused.

### `pwf locale add <lang> [--default <lang>]`, `pwf locale status [--json]`

`add` puts a language in `app/plan.json` `locales` and writes
`app/messages/<lang>.json` with the default locale's ids, each `""` to fill
in. The first `add` on a single-language app converts it: `locale` becomes
`defaultLocale`, the flat `messages` move to `app/messages/<default>.json`.
Nothing is written when the language breaks the address rules
(`APP_ADDRESS_CONFLICT`). `status` lists, per locale, the ids its catalogue
lacks or leaves empty, the pages whose address it translates and the pages
with a receipt of their own.

### `pwf page add <key> [--title <text>] [--pattern <name>] [--slot NAME=value]... [--path <lang>=<segments>]... [--layout false]`

Writes `app/surfaces/<key>.receipt.json` — empty, or a pattern applied as
pattern-format §4 says (every slot needs a `--slot` value; the wiring goes
into the page's capabilities) — and appends the key to `app.surfaceOrder`,
and to the plan's `surfaces` when the plan lists them. A taken key, a served
folder's name and an address conflict are refused before anything is written.

### `pwf upgrade [--check] [--from <.pwpack|folder>]... [--to <pack id>@<version>]`

Moves pinned packs to the newer builds `--from` names (pwf keeps no registry
of versions). For each: whether the build's `engines.pwfabric` admits this
engine, a new major, the blocks, props and patterns it drops and where the
app's receipts still use them, and its `CHANGELOG.md` between the versions.
Without `--check` it re-pins as `pwf add` does.

### `pwf check [out] [--links] [--weight] [--hydration] [--budget <KB>]`

Checks a built pwapp. Links: every internal `href`, `src` and `srcset` of
every page document names what the build serves (files, page documents, hash
routes, per-locale addresses, `_redirects`). Weight: each page document with
what it references, raw and gzipped, against a budget (default 500 KB gzip).
Hydration: the engine's hydration check in Chromium, when Playwright is
installed (an optional peer). Default: links and weight. Exit 1 on a broken
link, a page over budget or a failed page.

### `pwf compare <old> <new>`

Lists the addresses (pages in every locale, media, public files) an older
build answers that a new one neither has nor redirects; exit 1 when any.

### `pwf records import <type> <file.csv|json> [--replace]`, `pwf records export <type> [--format csv|json] [--out <file>]`

The app's content records, `app/content/<type>.json`, typed by
`app/definitions/entities.json`. Import reads CSV (RFC 4180, header row) or
JSON, checks every record as a session server would and writes all or none;
without `--replace` the records join the file by id. Export writes JSON or
CSV, a formula-like text cell guarded with a leading `'`.

### `pwf doctor [dir] [--online] [--json]`

The pwf, engine and Node versions; the folder's engine range and each pinned
pack (cached, matching its pin, made for this engine) with the fix for
`PIN_NOT_CACHED` and `ENGINE_RANGE_EXCLUDED`; an app's routing, languages and
font files; the saved PhiWebs session, read without the network (`--online`
asks who it belongs to).

### `pwf shoot [out] [--path <address>]... [--widths 390,1440] [--theme light,dark] [--locale <lang>] [--out <dir>]`

Serves the build as `pwf run` does and writes a full-page PNG per page, width
and colour scheme (default `<app>/.pwf/shots/`). Needs Playwright.

### `pwf publish --status [dir] [--project <id>]`

Shows where the folder's studio project stands: waiting for approval (with
the address to approve it), online (with its address), or not published.
Publishes nothing.

## Programmatic use

The commands are plain objects (`COMMANDS` from the package entry) that write
through a `CommandIO` and resolve to an exit code, so they run in-process.
`@pwfabric/cli/authoring` carries `createPack` and `addBlock` (the functions
behind `pwf create --pack` and `pwf add block`) and `readProject` (a folder as
`pwf validate` and `pwf pack` read it), without the dev server, the compiler or
the runner, so a tool that scaffolds and packs packs can bundle it. A bundled
caller passes `engineVersion` to `createPack`. `@pwfabric/cli/mcp` carries the
MCP server (`createPwfMcpServer`, `serveStdio`, `TOOLS`); it is the only entry
that loads the MCP SDK.

## License

Apache-2.0
