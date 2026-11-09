# @pwfabric/runner

## 1.2.0

- Fixed: a session from a provider sign-in (`startUrl` + `gatewaySessionUrl`, e.g. method `phiwebs`) is sent as `Authorization: Bearer` on the app's own record requests, as a password session always was. The app's API base is derived the same way for every sign-in method: `auth.json` `apiBase` when stated, else the first door address with its route removed (`loginUrl` − `/login`, … `startUrl` − `/_auth/start`, `gatewaySessionUrl` − `/_auth/session`). A ref that is not that base still gets no token.
- Fixed: a sign-in that comes back refused (`?auth_error=`, e.g. Cancel on the platform screen) is shown on an app that does not require sign-in too: the sign-in dialog opens with the message. It was shown only on a required app's wall.
- Added: optional `PwappAuth.apiBase`; `ownApiBaseOf(auth)` and `isOwnApiRef(ref, base)` are exported.

## 1.1.0

- A form binding's `successRedirect` and a `navigate` action's `url` are rewritten like hrefs, so a hash-routed app stays inside the app.

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
