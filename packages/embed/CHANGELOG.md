# @pwfabric/embed

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.
- `embed.js` turns zod's JIT off (`z.config({ jitless: true })`) before anything it bundles creates a schema. zod 4 otherwise probes `new Function`, which a pwapp's CSP reports as a `script-src` violation on every page. It is the page's one zod, so the runner and compiled blocks get the same setting.

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- No changes; released with the other packages at 1.1.0.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Fixed: `embed.js` seeds `globalThis.__pwfabric_sdk` with the authoring kit it already carries. A block written the documented way (`defineBlock` from `@pwfabric/authoring`) rendered nowhere a page ran only the renderer and the runner — every published app.

## 1.0.0-rc.1

- `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
