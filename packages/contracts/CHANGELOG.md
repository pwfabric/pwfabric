# @pwfabric/contracts

## 3.3.1

- No changes; released with the other packages at 3.3.1.

## 3.3.0

- No changes; released with the other packages at 3.3.0.

## 3.2.0

- No changes; released with the other packages at 3.2.0.

## 3.1.0

- Fixed: `AtomFileManifestSchema` accepts a `ui-appearance` atom's own `darkTheme` (a surface theme, as `appearance.md` describes). The schema is strict and refused every theme atom that shipped its dark variant.

## 3.0.1

- No changes; released with the other packages at 3.0.1.

## 3.0.0

Upgrading from 2.x: see [Upgrading to 3.0](https://pwfabric.com/upgrading-to-3).

### Breaking

- The package root is zod-free. zod schemas and zod-based parsers moved to `@pwfabric/contracts/schemas` (`AtomFileManifestSchema`, `surfaceDocumentSchema`, `safeParsePwpackIdentity`, `resolvePackClosure`, `SURFACE_EVENT_PAYLOAD_SCHEMAS` …); the root re-exports their types as types (#53).
- The root no longer exports the **values** of the atom, `requires.packs`, record-write and webfont modules. They are on `@pwfabric/contracts/pack` (`classifyAtom`, `ATOM_KINDS`, `satisfiesSemverRange` …), `/record-write` (`prepareRecordWrite`, `isRecordServerField` …) and `/webfonts` (`WEBFONT_ALLOW_LIST`, `findAllowedWebfont`, `parseFontStack`). Every type stays on the root (#55).
- `statusKeys.message` is replaced by `statusKeys.reason` and `statusKeys.fields` in `surfaceActionSchema` and form bindings (#49).
- `prepareRecordWrite` is strict: a numeral is refused for a `number` and `"on"`/`1` for a `boolean`. New field rules `email` type, `min`/`max`/`integer` and `mustBe`; a `relation` must name a record the caller can read; an entity's `unique` keys refuse a duplicate with `409 CONFLICT` (#51).

### Other changes

- Added: `fabric/block-prop` — the manifest's prop shape (`PropShape`, a JSON-Schema subset) and `applyBlockProps`, `checkPropValue`, `coercePropValue`, `propDefault`, `propShapeProblems`. A block's `manifest.json` `definition.props` is its only prop definition; a value that does not fit is kept as written (#53, #54).
- Added: `auth:signIn`, `auth:register` and `auth:signOut` actions in `surfaceActionSchema`; `pwpack.json` `app.signIn`; `auth.json` `registration` (`open | invite | closed`, `registrationOf`); the `ownerName` server role (#50).
- Added: a data source's `fields` (name → declared type) (#51) and `requiresSession` (#58).

## 2.2.0

- Changed (behaviour, documented meaning): a data source's `fallback` is sample data for a source **nothing is connected** to serve (no registered connector, no entity facade, no records base). A real failure binds no rows, whatever `fallback` says (data-protocol §2.5; see `@pwfabric/runtime`).
- Added (minor): `prepareRecordWrite(input)` — the record write contract every server that hosts an app's records runs on a create and an update: envelope members (`id`, `entityType`, `createdAt`, `updatedAt`) are dropped; a field the entity does not declare is refused; a field declared `server` (`"owner"`, `"createdAt"`, `"updatedAt"` or `{ "default": v }`) is set by the server, and a client value for it is refused, not dropped (a `default` field may be changed by an update); declared types are checked and stored as their type (`text`, `number`, `boolean`, `date`, `relation`, and new `enum` with `values`; a number or boolean sent as a string is accepted, a blank non-text value means no value); a `required` field must have a value and an update may not clear it. Every refusal is one `400 VALIDATION_FAILED` whose message lists `<field>: <reason>` joined with `; `. Also exported: `RECORD_SERVER_ROLES`, `RECORD_ENVELOPE_MEMBERS`, `isRecordServerField`, `readRecordFieldValue` and the types `RecordServerRole`, `RecordServerField`, `RecordFieldDeclaration`, `RecordWriteInput`, `RecordWriteResult`. A platform record backend implements the same contract.
- Added (minor): the `write` action in `surfaceActionSchema` — `{ type: "write", sourceId, op: "create" | "update" | "delete", id?, values?, statusKeys?: { loading, success, error, message, detail } }`.
- Added (minor): `pwpack.json` `app.notFound` (`PwpackIdentityApp.notFound`) — the key of the app's own not-found surface; it is not a route and stays out of `surfaceOrder`.
- Added (minor): `notFoundWhenEmpty` on a data source (`dataSourceSchema`) — the source is the record the page shows; settled with no record, the page is not found.
- Added (minor): `urlState` in the persistence capability config (`persistenceCapabilityConfigSchema`) — state keys that live in the page's address query.
- Added (minor): a theme may carry block colours the cascade has no name for (`codeSurface`, `codeHeader`, `codeText`, `codeMuted`, `codeBorder`, or any other camelCase name). `surfaceThemeToCSS` emits them as `--pw-color-<kebab>` (`--pw-color-code-surface`), they cascade like any colour, and their dark values come from `darkTheme.colors`. A name that is not camelCase, a value that could leave its declaration, or a token the cascade emits or derives itself is not taken. New export: `extraColorVars(colors)`; `SurfaceThemeColors` accepts the extra names.
- Added (minor): every allow-listed webfont carries metric-matched fallback metrics (`AllowedWebfont.fallback`, type `WebfontFallback`: `local` Arial / Times New Roman / Courier New, `sizeAdjust`, `ascent`, `descent`, `lineGap`), so a host can declare a `"<Family> Fallback"` face and the text does not move when the webfont arrives.

## 2.1.0

- Added (minor): `definition.origins` on a block manifest — the exact origins a block's own code reaches, by CSP directive (`connect`, `frame`, `img`, `media`, `font`, `style`); `BlockOriginsSchema`, `safeParseBlockOrigins`, `BLOCK_ORIGIN_INVALID`.
- Added (minor): `DynamicBlockProp { name, bindable? }` and `DynamicBlockDefinition.props`, the prop declarations a host hands the runtime in `blocks/manifest.json`.
- Fixed: a `setState` action without `value` (`{ "type": "setState", "key": "k" }`) parses again, as in 1.x, and so do `form:change` / `input:change` event payloads without `value`. zod 3 treated an object member typed `z.unknown()` / `z.any()` as optional; zod 4 makes it required, which 2.0.0 did not account for. Those members are now `.optional()`; the inferred types are back to `value?: unknown`.
- Added (minor): `pwpack.json` format 1.1 — four optional members on `PwpackIdentity` / `PwpackIdentitySchema`: `name` (non-empty string), `description` (string), `category` (lowercase slug, `PWPACK_CATEGORY_PATTERN`) and `tokens` (CSS custom property names the pack's blocks read from the host theme, `PWPACK_TOKEN_PATTERN`). A malformed value is refused with a message naming the member. Files without them parse as before.
- Fixed: `deriveDarkTheme` lifted a dark `primary`/`accent` until it cleared 3:1 on the derived dark **background** only. The derived card is one step lighter, so the lifted colour could fall under 3:1 on it (a light primary `#18181b` became `#60606c`: 3.09:1 on the page, 2.75:1 on the card). The lift now walks until the colour clears 3:1 on every derived ground — the background and, when the theme has one, the card. Same 0.05 lightness steps, same hue, same 3:1 floor; light themes are unchanged.
- Changes derived dark colours: themes whose primary or accent was lifted only just past 3:1 on the dark page now derive a one-or-two-step lighter primary/accent (and the matching `textOnPrimary`). Themes whose colours already cleared both grounds derive exactly as before.
- Added (minor): a connector or provider manifest may declare the entities it serves and the fields of their rows — `entities: [{ entityType, displayName?, fields: [{ name, type, label?, required?, targetTypeId? }] }]` on `AtomFileManifest` / `AtomFileManifestSchema`. `type` is one of the five app entity field types (`CONNECTOR_ENTITY_FIELD_TYPES`: text, number, boolean, date, relation); `targetTypeId` only on a relation. New exports: `ConnectorEntityFieldSchema`, `ConnectorEntityDeclarationSchema`, their types, and `connectorEntityFields(manifest)` — `entityType` → known row fields (`id` plus the declared names) for a host or validator. Manifests without `entities` parse as before.

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
