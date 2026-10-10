# @pwfabric/contracts

## Unreleased

- Removed: `WorldId`, `WorldBlueprintId`, `TeamId`, `OrganizationId`, `ListingId`, `PublisherId`, `PlanCode` and their constructors; `PublisherStatus`, `PublisherRegistration`, `ExtendedPublisherDescriptor`, `SerializedEntitlementsV2` (deprecated; platform concepts belong to the host). Removed the retired single-manifest types `ManifestAuthor`, `ArtifactProvides`, `ArtifactEntryPoints`, `PackageManifest`; `ArtifactDescriptor.manifest` and `PackageValidationResult.manifest` are now `PwpackManifest`.
- Removed: the theme colour `colors.surface` and the `--pw-color-surface` variable. `colors.card` is the container colour's one name and emits `--pw-color-card` only; a theme that still carries `colors.surface` fails validation.

## 1.0.0-rc.0

First release under the @pwfabric scope.
