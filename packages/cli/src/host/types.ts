/**
 * The local host: a small in-process implementation of the session and data
 * protocols (spec/session-protocol.md, spec/data-protocol.md) for development.
 *
 * It is NOT a production server. It keeps records in memory, signs in a
 * single development user without a password, and serves receipts from the
 * pwpack folder. `pwf dev` mounts it under a path prefix on its own HTTP
 * server; tests can mount it on their own.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

export interface LocalHostOptions {
  /** Absolute path of the pwpack folder (receipts, definitions, seed data). */
  readonly root: string
  /** Path prefix the host is mounted under, e.g. "/_host". */
  readonly prefix: string
  /** The development user signed in by the dev issuer. */
  readonly user?: { readonly id: string; readonly name: string; readonly email: string }
}

export interface LocalHost {
  /** Envelope fields the runner needs to reach this host (session, auth and data URLs). */
  envelopeEntries(origin: string): Readonly<Record<string, unknown>>
  /** Handles a request under `prefix`; resolves false when the path is not the host's. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  /** Clears records and sessions. */
  reset(): void
}

/** Implemented in ./local-host.ts. */
export type CreateLocalHost = (options: LocalHostOptions) => LocalHost
