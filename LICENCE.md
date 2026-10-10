# Licensing

This repository is licensed in two parts.

## Apache License 2.0

- `packages/contracts` — `@pwfabric/contracts`
- `packages/authoring` — `@pwfabric/authoring`
- `packages/pack` — `@pwfabric/pack`
- `packages/cli` — `@pwfabric/cli`

These are the interface: the types, schemas and authoring functions that
anything interoperating with PWFabric has to agree on. An interface that is
not free to adopt is not an interface, so these carry the Apache License 2.0
with no additional conditions. See [`LICENSE-APACHE`](./LICENSE-APACHE).

## Business Source License 1.1

- `packages/core` — `@pwfabric/core`
- `packages/runtime` — `@pwfabric/runtime`
- `packages/runner` — `@pwfabric/runner`
- `packages/embed` — `@pwfabric/embed`
- `packages/compiler` — `@pwfabric/compiler`

The engine. You may read it, change it, build on it, and run what you build —
for yourself, inside your company, or for your own customers. Each package
directory carries its own `LICENSE` with the exact terms.

**What the Additional Use Grant permits.** Production use, including hosting
applications you built with PWFabric on behalf of your customers. Self-hosting
a `pwapp` is explicitly this case.

**What it does not permit.** Offering PWFabric itself to third parties as a
hosted or managed service that gives them substantially the functionality of
PWFabric. That is the one thing reserved, and it is reserved because it is the
business that pays for the engine.

**Change Date.** Four years after a version is first published, that version
becomes available under the Apache License 2.0. The date is written into each
package's `LICENSE`.

For a commercial licence covering uses the grant does not reach, write to
[licensing@phimajor.com](mailto:licensing@phimajor.com).

## Why two licences

The split follows the shape of the thing. Contracts describe an agreement, and
an agreement should be free to enter. The engine is the work, and the work pays
for itself by being hosted by the people who wrote it.

## Trademarks

"PWFabric", "PhiMajor" and the PhiMajor logo are trademarks of PhiMajor
Solutions. The licences above grant rights to the code, not to the names. You
may state that your product is built with PWFabric; you may not name it in a
way that suggests it is PWFabric, or that PhiMajor published it.
