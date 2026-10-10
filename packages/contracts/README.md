# @pwfabric/contracts

The types and schemas every part of PWFabric agrees on: ids, results, versions,
blocks, surfaces, capabilities, events and the pwpack manifest. Everything else
in the engine depends on this package; it depends only on `zod`.

## Install

```bash
pnpm add @pwfabric/contracts@rc zod@3
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. Peer: TypeScript 5.4+.

## Main exports

| Export | What it is |
|--------|------------|
| `ok`, `err`, `isOk`, `isErr`, `unwrap`, `mapResult`, … | The `Result` type every engine call returns |
| `surfaceId`, `capabilityId`, `artifactId`, `parseId`, `isValidId`, … | Branded ids |
| `parseVersion`, `compareVersions`, `isValidVersion` | Semver helpers |
| `toJsonSchema`, `validationOk`, `validationErr` | Schema and validation helpers |
| `CapabilityBuilder`, `defineCapability` | Declare a capability |
| Block, surface, event and manifest types and schemas | The shapes a pwpack and a pwapp are made of |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/contracts` | Everything above (the only entry point) |

## Licence

Apache-2.0 — see `LICENSE`. No additional conditions, patent grant included. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
