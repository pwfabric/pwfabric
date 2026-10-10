# pwpack archive compatibility

Five independent pieces of code write or read
pwpack archives. This note records how each one frames the archive, where
they agree, where they disagree, and what this package does about it. The
test file `src/__tests__/compat.test.ts` re-creates each producer's framing
(`src/__fixtures__/producers.ts`) and proves the verdicts below.

The producers:

| | Producer | Role |
|---|---|---|
| P1 | Authoring plugin packer | Packs a developer's source folder for upload |
| P2 | First-party pack exporter (`export-tgz`) | Builds the source tgz of the first-party packs |
| P3 | App generator delivery (`.pwpack` of a built app) | Delivers a generated app as the canonical folder |
| P4 | A hosting platform's pack build service | Rebuilds an uploaded source tree into the published tgz |
| P5 | A hosting platform's project export and its extractor | Exports a project as a pack; opens every incoming tgz |

## Framing, side by side

| | P1 plugin | P2 exporter | P3 generator | P4 build service | P5 export / extractor | **this package** |
|---|---|---|---|---|---|---|
| Tar implementation | hand-written | hand-written (shared copy with P3) | hand-written | hand-written | hand-written | hand-written |
| Header format | pre-ustar (no magic) | ustar | ustar | ustar | ustar | ustar |
| Wrapper dir | none | none | none | `package/` | none | none (reads `package/`) |
| Layout on the wire | rootless: `atoms/` stripped, `app/surfaces/*` → `surfaces/*` | rootless, same as P1 | **canonical** (`pwpack.json`, `app/`, `atoms/`) | as the source tree (either) | rootless + app envelope at root | as the folder |
| Entry order | `readdir` order (unsorted) | sorted families, then `pwpack.json`, `package.json` appended | sorted (UTF-16) | all dirs (sorted), then files (sorted) | insertion order, `pwfabric.manifest.json` first | byte order, dirs interleaved |
| Directory entries | no | no | no | yes, 0755 | no | yes, 0755 |
| File mode | 0644 | 0644 | 0644 | 0644 | 0644 | 0644 |
| uid/gid, uname/gname | 0, empty | 0, empty | 0, empty | 0, empty | 0, empty | 0, empty |
| mtime | **wall clock** | 0 | 0 | 0 | **wall clock** | 0 |
| Paths > 100 bytes | **silently cut to 100 bytes** | throws | ustar prefix (shortest), else throws | ustar prefix (by char count), else throws | ustar prefix (longest), else PAX `path` | ustar prefix (longest), else PAX `path` |
| Text bytes | as-is | as-is | **CRLF → LF** | as-is (block/capability manifests rewritten) | as-is | as-is |
| gzip level | default (6) | 9 | 9 | 9 | default (6) | 9 |
| gzip OS byte | platform's | platform's | **forced 3** | platform's | platform's | forced 3 |
| `contentHash` | sha256 of tgz | prints sha256 of tgz | sha256 of tgz (bare hex in its ledger) | sha256 of tgz | sha256 of tgz | `hashPack` (content) + `legacyContentHash` (tgz) |

## Where they agree

- Rootless archives, POSIX `/` separators, no leading `/`.
- Regular files 0644, uid/gid 0, empty owner names.
- A `contentHash` of `sha256:` + hex of the compressed archive, and a
  `storageRef` of `pwpacks/<id without @, / → ->/<version>/<12 hex>.tgz`
  (P1 and P4 agree for `@pwpack/...` ids). `deriveManifest` reproduces both.
- Atom ids come from the contracts' `classifyAtom`; when two files classify
  as one atom the first in sorted order wins (P1, P4).
- The extractor (P5) refuses `..` segments, absolute and drive paths, NUL,
  symlink and hardlink members, and caps entries (5 000), per-file size
  (20 MiB), total size (50 MiB) and decompressed size (128 MiB). This
  package's defaults are the same numbers, plus a 64 MiB cap on the
  compressed input.

## Where they disagree — and what matters

1. **Determinism is not real for P1 and P5.** Both stamp the current time
   into every header, so the same folder never produces the same archive
   twice and their `contentHash` identifies a moment, not content.
2. **Cross-platform determinism is not real for P2 and P4.** zlib stamps the
   OS it was built for into gzip byte 9 (measured here: 10 on Windows, 3 on
   Linux). P4's header comment claims identical bytes across OSes; it does
   not pin the byte. P3 does. This package pins it to 3, so a Linux-written
   archive keeps its hash. Remaining assumption: the same Node zlib build
   compresses identically on every platform (P3 relies on this too). The
   framing-independent identity is `hashPack`, which does not depend on it.
3. **P1 corrupts long paths.** Names over 100 bytes are truncated in the
   header with no prefix and no error. Such an archive reads, but the path
   read back is the first 100 bytes of the real one. Nothing can recover it.
4. **P3 rewrites text.** CRLF becomes LF before packing, so its archive of a
   folder with CRLF files has a different content hash than the folder on
   disk. This package never transforms bytes.
5. **The rootless wire cannot carry an app.** P1 and P2 move
   `app/surfaces/<key>.receipt.json` to `surfaces/<key>.receipt.json`, where
   they classify as shelf `surface` atoms; `pwpack.json` still names
   `app.entry`, which `validatePack` then reports as `APP_SURFACE_MISSING`.
   P3 is the only producer that ships the canonical folder.
6. **`pwpack.json` `requires` has three shapes.** The contract schema says
   an array of strings. The first-party packs (P2) write an array of
   `{ id, range }` objects — every first-party pack with a dependency fails
   the contract schema (`IDENTITY_INVALID`). P4 reads `requires` only when it
   is an object (a record) and otherwise falls back to `package.json`.
   **Resolved:** the contract schema now accepts `{ id, range }` entries
   (the form producers should write) and bare names (older files). P4 must
   learn to read the array form when it adopts this package.
7. **P3 writes `pwpack.json` values the schema refuses:** a pin with
   `hash: null` when the catalog had no hash, and `app.entry: null` when a
   project has no surfaces. It also writes `app.title`, `app.description`
   and `app.icon` (now part of the schema) (they are stripped, not
   refused).
8. **Identity location differs.** P4 also looks for `src/pwpack.json` and
   falls back to `package.json` for id/version/requires; P1 synthesises a
   `package.json` when there is none; P5's export carries no `pwpack.json` at
   all, only `pwfabric.manifest.json` plus `project.json`,
   `navigation.json`, `connections.json`, `appearance.json` at the root.
9. **Sorting.** P3 and P4 sort with JavaScript's default (UTF-16 code
   units), P2 with `<`, and P4 sorts manifest atoms with `localeCompare`.
   This package uses UTF-8 byte order everywhere; it differs from the
   others only for non-ASCII or mixed-case names (`localeCompare` puts `a`
   before `B`).
10. **Ignored files differ.** P4 skips every dot-entry and `build/`, `out/`;
    P1 skips `node_modules`, `.git`, `.DS_Store`, `dist`, `*.tgz`; P2 skips
    tests and logs. `readFolder` skips `node_modules`, `dist`, `.git` and OS
    junk at any depth and `*.pwpack` at the root; anything else is the
    caller's decision (`ignore` option).

## What `readPwpack` accepts from each

| Producer | Reads | `validatePack` verdict |
|---|---|---|
| P1 plugin, a pack | yes | ok; `LAYOUT_ROOTLESS`, `LEGACY_PACKAGE_JSON` |
| P1 plugin, an app | yes | **error** `APP_SURFACE_MISSING` (point 5) |
| P1 plugin, path > 100 bytes | yes, truncated path | depends; the data is already lost (point 3) |
| P2 exporter, pack without dependencies | yes | ok; `LAYOUT_ROOTLESS`, `LEGACY_PACKAGE_JSON` |
| P2 exporter, pack with dependencies | yes | **error** `IDENTITY_INVALID` (point 6) |
| P3 generator delivery | yes, identical folder | ok, no issues; **error** `IDENTITY_INVALID` for null pins / entry (point 7) |
| P4 build service | yes, `package/` removed | as its source folder |
| P5 project export | yes, PAX names included | **error** `IDENTITY_MISSING`; `UNKNOWN_TOP_LEVEL` for the envelope files |

Verified against the real first-party packs: the exporter's archives of two
of them read, round-trip with an unchanged `hashPack`, and validate as
described (98 and 6 atoms).

Tolerated legacy framing: `package/` on every member, `./` prefixes,
directory entries, pre-ustar headers, the old GNU magic, signed-byte header
checksums, PAX `path` records, GNU `L` long names, PAX global headers (ignored)
and bare uncompressed tar. Refused: everything P5 refuses, plus devices and
FIFOs, a path appearing twice, malformed headers and base-256 sizes.

## What this package does not do

- It does not translate between layouts. A rootless archive is read as
  rootless; `validatePack` reports the layout (`canonical`, `rootless`,
  `mixed`) so a caller can decide.
- It does not rewrite block or capability manifests (P4 derives
  `definition.props` and `config.fields` from source while packing). That is
  a build step, not packaging.
- It does not preserve executable bits or timestamps.
