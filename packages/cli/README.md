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
`pwf_create_app`, `pwf_create_pack`, `pwf_add_pack`, `pwf_add_block`,
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
address. A pack: sends it to the PhiWebs marketplace for review as the
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
