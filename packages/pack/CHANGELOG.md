# @pwfabric/pack

## 1.1.0

- `validatePack` reports app content (`APP_CONTENT_UNDECLARED`, `APP_CONTENT_INVALID`, `APP_CONTENT_ID`, `APP_CONTENT_UNREADABLE`), access rules (`APP_ACCESS_RULE`) and receipts the app does not serve (`APP_SURFACE_NOT_SERVED`).

## 1.0.0

- First stable release. Same code as 1.0.0-rc.2.

## 1.0.0-rc.2

- No changes; version aligned with the family.

## 1.0.0-rc.1

- Packaging: `engines.node` is `>=22`; every export carries a `default` condition next to `import`, so `require()` works through Node 22's require(esm); source maps embed their sources (`sourcesContent`) and declaration maps are no longer shipped; `repository.url` is a full git URL.
