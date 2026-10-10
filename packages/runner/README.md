# @pwfabric/runner

The pwapp runner: a browser ES module that runs a built pwapp. It loads the
pwpack envelope, routes pages (hash or path), assembles navigation, and runs
the sign-in bridge, on top of the `@pwfabric/embed` renderer. `pwf build`
copies it into every app's `assets/runner.js`; you rarely import it yourself.

## Install

```bash
pnpm add @pwfabric/runner@rc
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. It runs in the browser, not in Node.

```js
import { runApp } from '@pwfabric/runner'

runApp({ source: './pwpack', blocks: './blocks/', engines: './engines', router: 'hash', locale: 'en' })
```

Under `router: 'path'`, the app's relative asset URLs resolve against the
shell's `<base href>`; a host serving the app under a sub-path should inject
one. See [self-hosting](https://pwfabric.com/self-host).

## Main exports

| Export | What it is |
|--------|------------|
| `runApp` | Boot a pwapp |
| `createRouter`, `resolveRouterMode` | The hash/path router |
| `createAuthBridge`, `bootSession`, `mountSignInGate`, `createAccountController` | Sign-in and session |
| `assembleNav`, `assembleFooter`, `composeTitle`, `renderNotFound` | Page assembly |
| `sessionDataCache`, `buildEntityFacade` | Data access |
| `THEME_PRESETS`, `RUNNER_COPY`, `copyFor` | Theme presets and UI copy |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/runner` | The bundled browser module `dist/runner.js` (the only entry point) |

## Licence

Business Source License 1.1 — see `LICENSE`. Use it, change it, and host what you build with it, for yourself or your own customers; do not offer PWFabric itself as a service. Each version becomes Apache-2.0 on the Change Date in `LICENSE`. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
