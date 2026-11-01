/**
 * THE APP'S OWN API BASE, and which data requests may carry the visitor's
 * session.
 *
 * Every source that reads the app's own records is a plain `fetch` to
 * `<base>/records/…`, and the source names its credential with
 * `authProviderRef: "<base>"`. The runner answers that ref with the visitor's
 * session token — and ONLY that ref: answering every ref would hand the token
 * to a connector's third-party endpoint.
 *
 * The base is not a constant either end agrees on; it is read back out of the
 * door `auth.json` was written with, the same way for every sign-in method:
 *
 *   1. `apiBase`, when `auth.json` states it;
 *   2. otherwise the first door address that ends in its known route —
 *      `loginUrl` (`/login`), `registerUrl` (`/register`), `sessionUrl`
 *      (`/session`), `logoutUrl` (`/logout`), `startUrl` (`/_auth/start`),
 *      `gatewaySessionUrl` (`/_auth/session`), `gatewayLogoutUrl`
 *      (`/_auth/logout`) — with that route removed.
 *
 * So a password door (`<base>/login`) and a provider door whose gateway
 * listens under the base (`<base>/_auth/start`) give the same answer. A
 * gateway on the app's own origin (`/_auth/start`) leaves nothing to read a
 * base from; such a host states `apiBase`.
 */

import type { PwappAuth } from './types.js'

type DoorAddresses = Pick<
  PwappAuth,
  'apiBase' | 'loginUrl' | 'registerUrl' | 'sessionUrl' | 'logoutUrl' | 'startUrl' | 'gatewaySessionUrl' | 'gatewayLogoutUrl'
>

/** Door addresses in the order they are read, each with the route it ends in. */
const DOOR_ROUTES: readonly (readonly [keyof DoorAddresses, string])[] = [
  ['loginUrl', '/login'],
  ['registerUrl', '/register'],
  ['sessionUrl', '/session'],
  ['logoutUrl', '/logout'],
  ['startUrl', '/_auth/start'],
  ['gatewaySessionUrl', '/_auth/session'],
  ['gatewayLogoutUrl', '/_auth/logout'],
]

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/** The app's own API base, or `null` when `auth.json` gives nothing to read one from. */
export function ownApiBaseOf(auth: Partial<DoorAddresses> | null | undefined): string | null {
  if (!auth) return null
  if (typeof auth.apiBase === 'string' && trimSlashes(auth.apiBase)) return trimSlashes(auth.apiBase)
  for (const [key, route] of DOOR_ROUTES) {
    const address = auth[key]
    if (typeof address !== 'string') continue
    const bare = trimSlashes(address.split(/[?#]/)[0] ?? '')
    if (!bare.endsWith(route)) continue
    const base = bare.slice(0, -route.length)
    if (base) return base
  }
  return null
}

function absolute(address: string, against: string): string | null {
  try {
    return trimSlashes(new URL(address, against).href)
  } catch {
    return null
  }
}

/**
 * Whether a source's `authProviderRef` names this app's own API.
 *
 * Equal as written (trailing slashes aside), or equal once both are resolved
 * against the page — `pwf dev` writes `/_host`, a host may write the full
 * address; both name the same door.
 */
export function isOwnApiRef(ref: string | undefined, base: string | null, pageUrl?: string): boolean {
  if (!ref || !base) return false
  if (trimSlashes(ref) === base) return true
  const page = pageUrl ?? (typeof location !== 'undefined' ? location.href : undefined)
  if (!page) return false
  const a = absolute(ref, page)
  return a !== null && a === absolute(base, page)
}
