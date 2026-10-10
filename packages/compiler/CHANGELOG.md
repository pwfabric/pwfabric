# @pwfabric/compiler

## Unreleased

- Fixed: a block module that exports only a `defineBlock()` definition resolves its component from `definition.component`; before, the loader found no component and the block did not render.

## 1.0.0-rc.1

- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
