# @pwfabric/authoring

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.
- `validateProps()`, `validateBlock()`, `createBlockInstance()`, a factory's config check and `defineBlock()`'s default-props warning read zod 4 issues; their messages are zod 4's (`Invalid input: expected number, received string`).
- Upgrading from 1.x: install `zod@4` and move the project's own schemas to it. What the engine's own move needed, for comparison:
  `z.record(X)` takes its key schema (`z.record(z.string(), X)`); a record keyed by an enum is exhaustive in zod 4 (`z.partialRecord` keeps the 1.x meaning);
  `refine(check, (value) => ({ message }))` is `refine(check, { error: (issue) => … })`; `ZodError.errors` is `.issues`; an issue `path` may hold symbols.

## 1.2.0

- No changes; released with the other packages at 1.2.0.

## 1.1.0

- No changes; released with the other packages at 1.1.0.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- No changes; version aligned with the family.

## 1.0.0-rc.1

- `zod` is a peer dependency (`^3.23.0`); `react` accepts 18 and 19 like the other packages.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
