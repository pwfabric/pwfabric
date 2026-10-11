# @pwfabric/runner

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Added: `runApp({ version })` — every file read under `source` (the envelope JSON and the receipts) is asked for as `?v=<version>` (`&v=` after an existing query), so a page never mixes two publishes' files out of a cache. `withVersion(url, version)` is exported. Without `version`, nothing changes.
- Changed (breaking): the provider button for a PhiWebs account is `{ method: 'phiwebs' }` (was `host`): `PwappProviderButton.method`, `ProviderLabelKey` and `RunnerCopy.gate.providers.phiwebs` follow. It still stands first and still reads "Continue with your account".

## 1.0.0-rc.1

- Removed: `mountLoginButton` (deprecated; use `mountSessionPill`).
- Ships type declarations; `exports` lists `types`. `zod` is a peer dependency (`^3.23.0`).
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.

## 1.0.0-rc.0

First release under the @pwfabric scope.
