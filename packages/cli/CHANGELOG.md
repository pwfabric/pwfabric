# @pwfabric/cli

## 1.0.0-rc.1

- `pwf --version` (and `-v`, `version`) prints the version.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
