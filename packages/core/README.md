# @pwfabric/core

The primitives the rest of the engine is built from: errors, logging, metrics,
tracing, contract and capability builders, retry and id helpers. It re-exports
`@pwfabric/contracts`, so one import gives you both.

## Install

```bash
pnpm add @pwfabric/core zod@3
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+.

## Main exports

| Export | What it is |
|--------|------------|
| everything from `@pwfabric/contracts` | Re-exported |
| `PWFabricError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `AppError`, `ErrorCode`, `getHttpStatus`, `isRetryable` | Errors and their HTTP mapping |
| `Logger`, `createLogger`, `ConsoleLogger`, `createObservabilityLogger` | Logging |
| `createTraceContext`, `createSpan`, `extractTraceId`, `injectTraceId` | Tracing |
| `observeAllWebVitals`, `observeLCP`, `observeINP`, …, `DEFAULT_BUDGET` | Web-vitals metrics |
| `defineContract`, `ContractBuilder`, `defineCapability`, `CapabilityBuilder` | Builders |
| `sleep`, `retry`, `generateId` | Utilities |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/core` | Everything above (the only entry point) |

## Licence

Business Source License 1.1 — see `LICENSE`. Use it, change it, and host what you build with it, for yourself or your own customers; do not offer PWFabric itself as a service. Each version becomes Apache-2.0 on the Change Date in `LICENSE`. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
