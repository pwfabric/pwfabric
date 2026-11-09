/**
 * `@pwfabric/cli/host` — the building blocks of the local host, for any host.
 *
 * `pwf dev` serves an app's sign-in, records and pages through
 * `createLocalHost`. A host of its own (a server, a worker, a test harness)
 * needs the same decisions, made the same way, so the pieces are exported
 * here as they are; `pwf dev` imports them from this entry too.
 *
 *   Access     `accessOf`, `parseRule` — what a caller may do with a model
 *              under the app's `auth.json` `access` rules.
 *   Records    `RecordStore` — an in-memory record store that enforces those
 *              rules (seeded from the app folder; throws `HostError`).
 *   Receipts   `rewriteEntitySources` — a receipt's `entity` sources rewritten
 *              to `rest` sources against `<base>/records/…`, with
 *              `authProviderRef: <base>` so the runner sends the visitor's
 *              session there.
 *   Addresses  `authAddresses` — the envelope `auth.json` for a declaration,
 *              pointed at `<base>`.
 *   Definitions `readAuth`, `readEntities`, `readSeed` — the app folder's
 *              declarations as the pieces above take them.
 *
 * These are Node modules (`node:fs`, `node:crypto`). Nothing here is a
 * production server: see `createLocalHost` for what the local host is not.
 */

export { accessOf, parseRule, RecordStore } from './records.js'
export type { Access, AccessReach, AccessVerb, AggregateAnswer, Caller, ListAnswer, Scope, Target } from './records.js'
export { rewriteEntitySources } from './receipts.js'
export { authAddresses, createLocalHost, DEFAULT_DEV_USER, SESSION_COOKIE } from './local-host.js'
export { readAuth, readEntities, readSeed } from './definitions.js'
export type { AuthDeclaration, EntityDeclaration, EntityField } from './definitions.js'
export { HostError } from './http.js'
export type { Principal } from './tokens.js'
export type { CreateLocalHost, LocalHost, LocalHostOptions } from './types.js'
