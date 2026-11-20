# @pwfabric/embed

## 3.3.0

- Fixed: a block passed as `components` gets the props its `dynamicBlocks` entry declares, as a loaded block does, and its module is not loaded (@pwfabric/runtime).

## 3.2.0

- No changes; released with the other packages at 3.2.0.

## 3.1.0

- No changes; released with the other packages at 3.1.0.

## 3.0.1

- No changes; released with the other packages at 3.0.1.

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- `embed.js` no longer imports zod: no `zod` host import, shim or `__pwfabric_zod` global; the package no longer depends on zod (#53).
- A block that imports `@pwfabric/authoring` on a seeded page gets the runtime plus the four `@pwfabric/authoring/block` functions (`defineBlock`, `isCustomBlockDefinition`, `createBlockInstance`, `validateBlockDefinition`), no longer `defineFactory`, the registry or the props validators (#55).

### Other changes

- Added: the `messages` render option (`useAppMessage` for every block) (#49) and the `identity` render option (#50).
- Added: `@pwfabric/embed/static.js`, the build-time renderer (`renderStatic`); `onHydrated`; `autoload` skips rendered surfaces; a hydration mismatch is reported on the console (#52).
- Changed: `embed.js` carries only what a visitor's page runs: 731 KB → 446 KB raw, 217 KB → 138 KB gzip, measured on the release build (#53, #55).
- Fixed: hydration keeps prose and inline SVG painted at build. The React a block imports keeps one `{ __html }` object per markup string, so React does not rewrite it (#57).
- Changed: `buildFatHtml` no longer writes a "Surface" title or `lang="en"` (#49).

## 2.2.0

- Added (minor): render options `onTitle`, `onDescription`, `locale` and `address`, passed through to the runtime.
- Added (minor): `loadBlocks(blocks, descriptors)` (also `window.PWFabric.loadBlocks`), `surfaceBlockTypes` and `BLOCK_WAIT_MS`: the modules of every block type a page places are loaded all at once and the fat `render` waits for them (capped at 3 s), so a page is drawn in one commit instead of one wave per nesting level.
- Changed: `embed.js` seeds every global a block may import (`__pwfabric_react_dom` and `__pwfabric_core` too), so a page needs no `seed.js` before it.
- Changed (behaviour): `embed.js` ships zod's English messages only (`z.locales.en`) and a stand-in for `next/image`: 999 KB → 731 KB (258 → 217 KB gzip). A block that set another zod locale gets English messages.

## 2.1.0

- Added (minor): a `linkHref` option on the render entry points, passed through to the runtime: how the host writes an in-app link whose page was an expression (`href: "{{item.url}}"`), rewritten for its router once the value is known. The runner sets it; a host that renders receipts itself sets it the same way.

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
