# @pwfabric/contracts

## Unreleased

- Fixed: a `setState` action without `value` (`{ "type": "setState", "key": "k" }`) parses again, as in 1.x, and so do `form:change` / `input:change` event payloads without `value`. zod 3 treated an object member typed `z.unknown()` / `z.any()` as optional; zod 4 makes it required, which 2.0.0 did not account for. Those members are now `.optional()`; the inferred types are back to `value?: unknown`.
- Added (minor): `pwpack.json` format 1.1 — four optional members on `PwpackIdentity` / `PwpackIdentitySchema`: `name` (non-empty string), `description` (string), `category` (lowercase slug, `PWPACK_CATEGORY_PATTERN`) and `tokens` (CSS custom property names the pack's blocks read from the host theme, `PWPACK_TOKEN_PATTERN`). A malformed value is refused with a message naming the member. Files without them parse as before.

## 2.0.0

- Changed (breaking): `zod` is a peer dependency at `^4.6.6` (was `^3.23.0`). zod 3 has no fix for GHSA “Zod can exhaust memory while validating oversized constrained collections”. A project on zod 3 stays on 1.x.
- Every exported schema is a zod 4 schema. Behaviour is unchanged: string-keyed records keep string keys, and a project identity's `connections` still names only the social methods it uses (`z.partialRecord`). Validation messages are zod 4's.
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

- Changed (breaking): the login method for an account on the PhiWebs platform is `phiwebs`, not `host` — `IDENTITY_METHODS` is `['password', 'phiwebs', 'google', 'github', 'microsoft']`, and its auth-provider atom is `auth.phiwebs` (`auth/phiwebs.knowledge.json`). A declaration naming `host` no longer parses. PWFabric is PhiWebs Fabric: the method names the platform on purpose.
- Docs: an `entity` data source binds its records as a list under its id, `{{<id>}}` (the comment said `{{data.<id>.items}}`).

## 1.0.0-rc.1

- Removed: `WorldId`, `WorldBlueprintId`, `TeamId`, `OrganizationId`, `ListingId`, `PublisherId`, `PlanCode` and their constructors; `PublisherStatus`, `PublisherRegistration`, `ExtendedPublisherDescriptor`, `SerializedEntitlementsV2` (deprecated; platform concepts belong to the host). Removed the retired single-manifest types `ManifestAuthor`, `ArtifactProvides`, `ArtifactEntryPoints`, `PackageManifest`; `ArtifactDescriptor.manifest` and `PackageValidationResult.manifest` are now `PwpackManifest`.
- Removed: the theme colour `colors.surface` and the `--pw-color-surface` variable. `colors.card` is the container colour's one name and emits `--pw-color-card` only; a theme that still carries `colors.surface` fails validation.
- `zod` is a peer dependency (`^3.23.0`), so an app and the engine share one zod; the unused `typescript` peer is gone (TypeScript 6/7 projects no longer get nested copies of this package).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
