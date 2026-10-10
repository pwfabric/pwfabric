# @pwfabric/runner

## 1.0.0-rc.1

- Removed: `mountLoginButton` (deprecated; use `mountSessionPill`).
- Ships type declarations; `exports` lists `types`. `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
