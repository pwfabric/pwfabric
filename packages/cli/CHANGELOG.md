# @pwfabric/cli

## 1.0.0-rc.2

- Changed (breaking): the local host offers the PhiWebs-account method as `phiwebs` (was `host`).
- `shimSource` and `isExportableName` moved to `@pwfabric/core`; `seed.js` no longer seeds `__pwfabric_sdk` (the renderer does).

## 1.0.0-rc.1

- `pwf --version` (and `-v`, `version`) prints the version.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
