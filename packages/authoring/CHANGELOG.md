# @pwfabric/authoring

## Unreleased

- `zod` is a peer dependency (`^3.23.0`); `react` accepts 18 and 19 like the other packages.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
