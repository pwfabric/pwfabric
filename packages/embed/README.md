# @pwfabric/embed

Renders a PWFabric surface anywhere, with the same renderer as `@pwfabric/runtime`. Two modes:
**thin** fetches the surface and its render grants from an API; **fat** renders
an inline surface, its block bundles and appearance fully offline, with no
backend. A `data-pw-surface` auto-loader is wired on load.

## Install

```bash
pnpm add @pwfabric/embed react react-dom
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. Peers: `react` and `react-dom` 18 or 19.

## Main exports

| Export | What it is |
|--------|------------|
| `PWFabric` (also the default export) | `{ render, renderFat, loadThin, autoload }` |
| `renderFat`, `fatCoreOptions` | Offline (fat) rendering |
| `loadThin`, `grantsToDescriptors` | API-backed (thin) rendering |
| `buildFatHtml` | Build a self-contained HTML page for a surface |
| `autoload` | Mount every `[data-pw-surface]` element |
| `EmbedMode`, `EmbedSource`, `RenderFatOptions`, `LoadThinOptions`, … | Types |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/embed` | Everything above |
| `@pwfabric/embed/embed.js` | The self-contained browser bundle `dist/embed.js`, for a `<script type="module">` or a host that ships it as a file |

## Licence

Business Source License 1.1 — see `LICENSE`. Use it, change it, and host what you build with it, for yourself or your own customers; do not offer PWFabric itself as a service. Each version becomes Apache-2.0 on the Change Date in `LICENSE`. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
