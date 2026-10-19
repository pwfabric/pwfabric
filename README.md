# PWFabric

PWFabric is the engine that renders an app: a small set of packages that turn a
declarative surface — blocks, bindings, capabilities, appearance — into a live
page, in a browser or on a server. It needs no hosted service: everything an
app needs at runtime is either in its bundle or behind a protocol you can
implement yourself.

An app built on PWFabric is a portable thing. Its source travels as a `pwpack`,
its runnable form as a `pwapp`, and either can be served from any static host.
That portability is the reason this repository is open: a promise that your app
is yours cannot rest on an engine you are not allowed to read.

## Packages

| Package | What it is | Licence |
|---|---|---|
| `@pwfabric/contracts` | The types and schemas everything agrees on | Apache-2.0 |
| `@pwfabric/authoring` | `defineBlock`, `defineFactory` — write your own blocks | Apache-2.0 |
| `@pwfabric/core` | Primitives the other packages build on | BSL 1.1 |
| `@pwfabric/runtime` | The renderer: blocks, bindings, capabilities, appearance | BSL 1.1 |
| `@pwfabric/runner` | Runs a `pwapp` — routing, navigation, sign-in | BSL 1.1 |
| `@pwfabric/embed` | Embeds a surface in a page you already have | BSL 1.1 |
| `@pwfabric/compiler` | Compiles a block or capability source into the module the runtime loads | BSL 1.1 |
| `@pwfabric/pack` | Reads, validates, hashes and writes `pwpack` folders and archives | Apache-2.0 |
| `@pwfabric/cli` | `pwf` — create, validate, pack, build and run apps from the command line | Apache-2.0 |

The interface is Apache-2.0 on purpose: anything that has to agree with
PWFabric should be free to do so without asking. The engine itself is under the
Business Source License — you may use it, change it, and host what you build
with it, including for your own customers. What you may not do is offer PWFabric
itself as a competing hosted service. Four years after each release, that
version becomes Apache-2.0. See [LICENCE.md](./LICENCE.md) for the exact terms
and [licensing@phimajor.com](mailto:licensing@phimajor.com) for anything else.

## Getting started

The shortest way to an app is the command line. It needs Node 22.

```bash
npm install -g @pwfabric/cli
pwf create my-app --foundation /path/to/foundation.pwpack
cd my-app
pwf dev          # serves the app and reloads on every change
pwf build        # writes the static app to .pwf/out/
```

An app's blocks and themes come from a pack, usually the
[foundation](https://github.com/pwfabric/foundation). Its README says
how to build the `.pwpack` archive that `--foundation` takes. The
[examples](https://github.com/pwfabric/examples) are three complete
apps to start from.

Writing your own block takes one function:

```tsx
import { defineBlock } from '@pwfabric/authoring'
import { z } from 'zod'

export const priceTag = defineBlock({
  type: 'price-tag',
  name: 'Price tag',
  schema: z.object({ amount: z.number(), currency: z.string() }),
  defaultProps: { amount: 0, currency: 'EUR' },
  component: ({ props }) => <b>{props.amount} {props.currency}</b>,
})
```

These packages are at **1.1.0**, published on npm
(`npm install @pwfabric/authoring`). They are ES
modules only: a project that imports them sets `"type": "module"`. Blocks
take `zod@3`.

Full documentation is at [pwfabric.com](https://pwfabric.com).

## Development

```bash
pnpm install
pnpm build      # builds every package
pnpm test       # 4,500+ tests
pnpm typecheck
```

## Related repositories

| Repository | What it holds |
|---|---|
| [pwfabric/pwfabric](https://github.com/pwfabric/pwfabric) | This one: the engine packages |
| [pwfabric/spec](https://github.com/pwfabric/spec) | The file formats and protocols, their JSON Schemas and conformance fixtures |
| [pwfabric/foundation](https://github.com/pwfabric/foundation) | The standard library pack: core blocks, shells, two themes, capabilities |
| [pwfabric/examples](https://github.com/pwfabric/examples) | Three small apps to build and run with `pwf` |

Clone the spec into `spec/` to run `pnpm spec:conformance`, the CLI smoke
(`pnpm smoke:cli`) and the CLI's schema assertions; without it those are
skipped or have nothing to read.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first — it explains what changes are
welcome, what the contract packages guarantee, and why a breaking change to
`@pwfabric/contracts` is a different kind of conversation.

Security issues go to [security@phimajor.com](mailto:security@phimajor.com),
never to a public issue. See [SECURITY.md](./SECURITY.md).

## CI

CI (`.github/workflows/ci.yml`) needs no repository secrets, so a pull request
from a fork runs the same checks as any other: install, build, typecheck,
tests with each package's coverage threshold, the spec conformance fixtures
and the CLI smoke. Every `@pwfabric` dependency inside this repository is a
workspace link, so `pnpm install --frozen-lockfile` never needs a registry
token.
