/**
 * Who the visitor is, on page load — the order, in one place.
 *
 * 1. `readAuthError` — a failed sign-in round trip left `?auth_error=` in the
 *    address bar. It is read and wiped FIRST, before the router can mistake
 *    it for the app's own query string, and whether or not a session exists.
 * 2. `readAppSession` — a session stored in this tab wins, with no request.
 * 3. `readGatewaySession` — nothing stored: the gateway may hold a cookie
 *    from a social sign-in that just came back, or from an earlier tab.
 * 4. `writeAppSession` — what the gateway answered is stored, so page
 *    navigation and reload need no second round trip.
 *
 * Step 3 is skipped for an external issuer: that door is the PKCE bridge in
 * `auth.ts`, and the gateway keeps no cookie for it.
 *
 * Lifted out of `run-app.ts` so the order can be tested; `run-app.ts` is
 * browser orchestration and is not.
 *
 * @module @pwfabric/runner/boot-session
 */

import {
  readAppSession,
  readAuthError,
  readGatewaySession,
  writeAppSession,
  type AppSession,
} from './app-session.js'
import type { KeyValueStorage } from './pkce.js'
import type { PwappAuth, PwappProject } from './types.js'

export interface BootSessionInput {
  readonly project: PwappProject
  readonly auth: PwappAuth | null | undefined
  readonly storage: KeyValueStorage
  readonly appId: string
  readonly fetchImpl?: typeof fetch | undefined
  readonly location?: Pick<Location, 'pathname' | 'search' | 'hash'> | undefined
  readonly history?: Pick<History, 'replaceState'> | undefined
}

export interface BootSessionResult {
  /** The app session to start with, or null. */
  readonly session: AppSession | null
  /** The `?auth_error=` code this load arrived with, or null. */
  readonly authError: string | null
}

/** True when the gateway may hold a session cookie for this app. */
function gatewayKeepsSession(project: PwappProject, auth: PwappAuth | null | undefined): boolean {
  if (!auth) return false
  if (project.identity?.topology === 'external') return false
  return auth.provider !== 'oauth2-pkce'
}

export async function bootSession(input: BootSessionInput): Promise<BootSessionResult> {
  const authError = readAuthError(input.location ?? location, input.history ?? history)

  const stored = readAppSession(input.storage, input.appId)
  if (stored) return { session: stored, authError }

  if (!gatewayKeepsSession(input.project, input.auth)) return { session: null, authError }

  const fromGateway = await readGatewaySession(input.auth, input.fetchImpl ?? fetch)
  if (fromGateway) writeAppSession(input.storage, input.appId, fromGateway)
  return { session: fromGateway, authError }
}
