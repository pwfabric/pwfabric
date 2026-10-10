/**
 * The contract between `pwf dev` (./server.ts, written by the dev lane) and
 * the rest of the CLI.
 *
 * `pwf dev` watches a pwpack folder, compiles its atoms with the engine's
 * compiler, builds an envelope from the folder, and serves a page that boots
 * the runner against it. When the app declares data or sign-in, it mounts a
 * local host (../host) that implements the session and data protocols.
 */

import type { LocalHost } from '../host/types.js'

export interface DevServerOptions {
  /** Absolute path of the pwpack folder to serve. */
  readonly root: string
  /** Port to listen on; 0 picks a free port. Default 4600. */
  readonly port?: number
  /** Host interface to bind. Default 127.0.0.1. */
  readonly hostname?: string
  /** Mount a local host for data and sign-in. Default: only when the app declares them. */
  readonly localHost?: boolean | LocalHost
  /** Called with human-readable progress lines. */
  readonly log?: (line: string) => void
}

export interface DevServer {
  /** The URL the app is served at, e.g. http://127.0.0.1:4600/. */
  readonly url: string
  /** Rebuilds now (the watcher also rebuilds on change). */
  rebuild(): Promise<DevBuildResult>
  /** Stops the watcher and the HTTP server. */
  close(): Promise<void>
}

export interface DevBuildResult {
  readonly ok: boolean
  /** Atoms compiled in this build. */
  readonly compiled: number
  /** Compiler and validation diagnostics, already formatted for a terminal. */
  readonly diagnostics: readonly string[]
  readonly ms: number
}

/** Implemented in ./server.ts. */
export type StartDevServer = (options: DevServerOptions) => Promise<DevServer>
