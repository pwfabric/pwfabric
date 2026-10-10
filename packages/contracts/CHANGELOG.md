# @pwfabric/contracts

## Unreleased

- Changed (breaking): the login method for an account on the PhiWebs platform is `phiwebs`, not `host` — `IDENTITY_METHODS` is `['password', 'phiwebs', 'google', 'github', 'microsoft']`, and its auth-provider atom is `auth.phiwebs` (`auth/phiwebs.knowledge.json`). A declaration naming `host` no longer parses. PWFabric is PhiWebs Fabric: the method names the platform on purpose.

## 1.0.0-rc.1

- Removed: `WorldId`, `WorldBlueprintId`, `TeamId`, `OrganizationId`, `ListingId`, `PublisherId`, `PlanCode` and their constructors; `PublisherStatus`, `PublisherRegistration`, `ExtendedPublisherDescriptor`, `SerializedEntitlementsV2` (deprecated; platform concepts belong to the host). Removed the retired single-manifest types `ManifestAuthor`, `ArtifactProvides`, `ArtifactEntryPoints`, `PackageManifest`; `ArtifactDescriptor.manifest` and `PackageValidationResult.manifest` are now `PwpackManifest`.
- Removed: the theme colour `colors.surface` and the `--pw-color-surface` variable. `colors.card` is the container colour's one name and emits `--pw-color-card` only; a theme that still carries `colors.surface` fails validation.
- `zod` is a peer dependency (`^3.23.0`), so an app and the engine share one zod; the unused `typescript` peer is gone (TypeScript 6/7 projects no longer get nested copies of this package).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
