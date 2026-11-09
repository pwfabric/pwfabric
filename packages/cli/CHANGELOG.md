# @pwfabric/cli

## 1.2.0

- Added: `@pwfabric/cli/host`, a public entry for hosts other than `pwf dev`: `accessOf`, `parseRule`, `RecordStore`, `rewriteEntitySources`, `authAddresses`, `createLocalHost`, `readAuth`, `readEntities`, `readSeed`, `HostError`, `DEFAULT_DEV_USER`, `SESSION_COOKIE`, with their types (`Access`, `AccessVerb`, `AccessReach`, `Target`, `Caller`, `ListAnswer`, `AggregateAnswer`, `Scope`, `AuthDeclaration`, `EntityDeclaration`, `EntityField`, `Principal`, `LocalHost`, `LocalHostOptions`, `CreateLocalHost`). `pwf dev` imports the same entry.
- The envelope `auth.json` the local host writes states `apiBase` (every door, the external issuer included).
- Changed (stricter): once an app declares any access rule, a model no rule names is closed (`401`/`403`); an app with no rule stays open.
- Changed (stricter): a `count`-only grant answers the plain, unfiltered `/count` only; a filtered count and `/aggregate` need `list` and run over the rows `list` reaches.
- `pwf validate` and `pwf pack` report `ACCESS_RULE_MISSING` (an error) for every declared model no `access` rule names, including every model of an app with no `access` block; the message shows how to add a rule, with an explicit `public` rule for public data.

## 1.1.0

- The local host enforces the access rules of `auth.json` (`access.rules`): subjects `public`, `member` or a declared role; verbs `create`, `list`, `view`, `update`, `delete`, `count` (`read`, `write`); `own`. 401 without a session, 403 with one, 404 outside an `own` grant.
- `dev@localhost` signs in with every declared role; any other e-mail as a plain member. No password is checked.
- Collections are seeded from `app/content/` then `app/data/`.
- An `auth.json` holding only `access` is no identity: `project.json` carries none and no envelope `auth.json` is served.
- Envelope `auth.json` addresses are relative to the page.
- `pwf validate` also reports `SEED_INVALID`, `ENTITY_INVALID` and `ENTITY_UNDECLARED`.
- Removed: the draft entity `scope` and inferring owner collections from rule prose.

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- Changed (breaking): the local host offers the PhiWebs-account method as `phiwebs` (was `host`).
- `shimSource` and `isExportableName` moved to `@pwfabric/core`; `seed.js` no longer seeds `__pwfabric_sdk` (the renderer does).

## 1.0.0-rc.1

- `pwf --version` (and `-v`, `version`) prints the version.
- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
