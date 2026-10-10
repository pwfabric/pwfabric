/**
 * Opaque tokens, in memory.
 *
 * Every credential the local host hands out — an app session, an issuer
 * access token, a door token, a refresh token, an authorization code — is 32
 * random bytes, base64url. Only its SHA-256 is kept (as a session server
 * should), so even a heap dump of the development server holds no usable
 * token. Expired entries are dropped when they are looked up.
 */

import { createHash, randomBytes } from 'node:crypto'

export interface Principal {
  readonly id: string
  readonly email: string
  readonly displayName: string
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex')

export class TokenStore<T extends { readonly expiresAt: number }> {
  private readonly entries = new Map<string, T>()

  /** Mints a token for `entry` and returns it. */
  issue(entry: T): string {
    const token = newToken()
    this.entries.set(digest(token), entry)
    return token
  }

  /** The live entry for `token`, or undefined (unknown or expired). */
  get(token: string | undefined): T | undefined {
    if (!token) return undefined
    const key = digest(token)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  /** Looks the token up and forgets it — single use. */
  take(token: string | undefined): T | undefined {
    const entry = this.get(token)
    if (entry && token) this.entries.delete(digest(token))
    return entry
  }

  revoke(token: string | undefined): void {
    if (token) this.entries.delete(digest(token))
  }

  clear(): void {
    this.entries.clear()
  }
}
