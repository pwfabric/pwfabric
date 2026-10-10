# @pwfabric/runtime

The engine that renders a surface: the React surface and block renderers, data binding,
forms, entities, connectors, routing, SEO, state and the capability kernel. It
re-exports `@pwfabric/contracts`.

## Install

```bash
pnpm add @pwfabric/runtime@rc zod@3 react react-dom
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. Peers: `react` and `react-dom` 18 or 19; `next` 14–16 only if you use the
Next.js image adapter.

## Main exports

| Export | What it is |
|--------|------------|
| everything from `@pwfabric/contracts` | Re-exported |
| `BlockSurfaceRenderer`, `DataBoundSurfaceRenderer`, `BlockRenderer`, `BlockErrorBoundary` | Render a surface and its blocks |
| `createFabric`, `FabricKernel`, `createRegistry`, `createEventBus` | The capability kernel |
| `useSurfaceEvents`, `useSurfaceId`, `useSurfaceConnections`, `useEntitlements` | Hooks for block components |
| binding, forms, entity, connector, routing, SEO, state and cache APIs | Re-exported from their modules |
| `DefaultImageAdapter`, `NextImageAdapter` | Image adapters |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/runtime` | Everything above |
| `@pwfabric/runtime/adapters` | Image adapters (`DefaultImageAdapter`, `NextImageAdapter`) |
| `@pwfabric/runtime/capability` | The platform capability catalogue and lookups |
| `@pwfabric/runtime/blocks` | Block registry, component types, composition rules |
| `@pwfabric/runtime/auth` | Auth providers (`createAuthProvider`, `ApiKeyAuthProvider`, `MsalAuthProvider`) |
| `@pwfabric/runtime/data` | `DataService`, `createDataService` and the data capability provider |
| `@pwfabric/runtime/blocks/*` | One module of `blocks/`, e.g. `@pwfabric/runtime/blocks/hooks` |
| `@pwfabric/runtime/render/*` | One module of `render/`, e.g. `@pwfabric/runtime/render/renderer` |

## Licence

Business Source License 1.1 — see `LICENSE`. Use it, change it, and host what you build with it, for yourself or your own customers; do not offer PWFabric itself as a service. Each version becomes Apache-2.0 on the Change Date in `LICENSE`. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
