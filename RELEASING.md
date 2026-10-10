# Releasing

## One-time repository setup

1. **Branch protection on `main`:** require the `ci` status check and one
   approving review.
2. **Environment `release`:** add required reviewers (the maintainers who may
   publish) and the secret `NPM_TOKEN`, an npm automation token with publish
   rights on the `@pwfabric` scope. Only the release job can read it; no pull
   request, from a fork or not, ever does.
3. **The other repositories:** `pwfabric/spec`,
   `pwfabric/foundation` and `pwfabric/examples` check this
   repository out in their CI, and this one checks the spec out. All four are
   public, so the default CI token reads them.

## Cutting a release

Versions follow semver; a prerelease carries its channel and a counter after
a dash, with a dot between them: `1.0.0-rc.0`, `1.0.0-rc.1`, `1.1.0-beta.0`
(the dot makes `rc.10` sort after `rc.9`). A prerelease always sorts before
its release, and no ordinary range (`^1.0.0`) picks one up.

1. Every package in `packages/` carries the version being released (the
   `version` field), on a commit of `main` whose `ci` is green.
2. Create a GitHub Release with the tag `v<version>` (for example
   `v1.0.0-rc.0`) on that commit and publish it. Tick **Pre-release** for a
   prerelease version, and only then: the workflow refuses a mismatch either
   way, so a release candidate is never shown as the latest release.
3. The `Release` workflow waits for an approval in the `release` environment.
   Once approved it checks that the tag matches every package, builds, tests
   and publishes to npm with provenance. The npm dist-tag is the channel's
   name — `1.0.0-rc.0` goes to `rc`, `1.1.0-beta.0` to `beta` — and a
   stable version goes to `latest`. Users ask for a channel by name
   (`npm install @pwfabric/runtime@rc`); the channels the workflow knows are
   `alpha`, `beta`, `rc`, `next` and `canary`.
4. A re-run after a partial failure publishes only what is not on npm yet.

The first version npm ever sees of a package also becomes its `latest`,
even when it is a release candidate; the first stable release takes `latest`
over.

## After the engine release

- **Foundation:** its CI's `engine from npm` leg starts running by itself once
  the engine version it names is on npm. Release it with a GitHub Release
  tagged `v<its version>`; its workflow attaches `foundation-<version>.pwpack`
  and the source `.tgz` to the release.
- **Examples:** each example pins the foundation build by content hash. If
  the foundation changed after the last pin, run `pwf add <foundation.pwpack>`
  in each example (or `node check.mjs --keep` and copy the pins) and commit.
- **Documentation site** (`site/`): deploy it so pwfabric.com shows this
  version.
