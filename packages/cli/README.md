# pwf

The PWFabric command line. It creates, checks, packs and serves PWFabric apps
using only the engine's own packages. It never calls a hosted service: there is
no login, publish or deploy.

```sh
pwf create my-shop --foundation ./foundation   # a new app folder
cd my-shop
pwf validate                                   # check it
pwf pack                                       # write my-shop-0.1.0.pwpack
pwf add ../cards-2.1.0.pwpack                  # install and pin another pack
pwf run ./dist-app                             # serve a built pwapp
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

### `pwf add <path-to.pwpack|dir> [--dir <project>]`

Validates the pack, copies its pack content to `.pwf/packs/<id>@<version>/`,
pins it in `packs[]` by the content hash of exactly what was copied and adds `{ id, range: "^<major>.0.0" }` to
`requires` (replacing an earlier entry for the same id). Only local archives
and folders: resolving packs from npm or a pack registry is not supported.

### `pwf dev [dir] [--port <n>] [--host <name>] [--local-host | --no-host]`

Assembles the app in memory, serves it on `http://127.0.0.1:4600/` (`--port 0`
picks a free port), rebuilds on every change and reloads the page. While a
build has errors the page shows them, and so does the terminal.

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
free port. Page paths without a file extension are answered with `index.html`,
so path-routed apps work; a missing asset is a 404. Headers the folder's
`_headers` file declares (the app's policy) are sent with matching files.
Stop it with Ctrl-C.

## Programmatic use

The commands are plain objects (`COMMANDS` from the package entry) that write
through a `CommandIO` and resolve to an exit code, so they run in-process.

## License

Apache-2.0
