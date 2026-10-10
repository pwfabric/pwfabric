# @pwfabric/embed

## Unreleased

- Fixed: `embed.js` seeds `globalThis.__pwfabric_sdk` with the authoring kit it already carries. A block written the documented way (`defineBlock` from `@pwfabric/authoring`) rendered nowhere a page ran only the renderer and the runner — every published app.

## 1.0.0-rc.1

- `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
