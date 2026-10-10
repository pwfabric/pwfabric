/**
 * Delegated OAuth scope lists — the one reader
 *
 * WHY A STRING IS REFUSED. A scope list stored as a string and split on
 * `/[\s,]+/` turns the JSON TEXT `["Sites.Read.All","User.Read"]` into
 * `["Sites.Read.All"` and `"User.Read"]` — things shaped like scopes that an
 * identity provider refuses (Microsoft Entra: `AADSTS650053 ... asked for
 * scope '["Sites.Read.All"'`).
 *
 * A scope list is a LIST; a string is not a list awaiting a parse, it is a
 * malformed value. Separate readers would each get a chance to disagree,
 * which is why this is one module the consumers import rather than a rule
 * each of them remembers.
 *
 * WHY A READER FORGIVES AND A WRITER DOES NOT. The write boundary rejects
 * outright (HTTP 400 — see the API's scope-shape guard): nothing malformed
 * should enter. A reader, though, runs at render time against rows that are
 * already stored, and a canvas that throws over one bad row is worse than one
 * that shows the row as broken. So it keeps what is usable, sets aside what is
 * not, and RETURNS the rejects so a surface can display them. The original bug
 * survived precisely because nothing ever surfaced them.
 *
 * @module @pwfabric/core/oauth-scopes
 */

/**
 * Characters that cannot appear inside a delegated scope.
 *
 * Deliberately a REJECT-list rather than an allow-list: real scopes come bare
 * (`Sites.Read.All`, `offline_access`), URI-qualified
 * (`https://graph.microsoft.com/Mail.Read`) and app-id-qualified
 * (`api://<guid>/access_as_user`), and an allow-list tight enough to be
 * useful would refuse valid scopes from a provider we have not met yet. What
 * IS refused is what a scope can never contain: whitespace (the OAuth
 * delimiter itself), and the quotes/brackets/commas that betray a stringified
 * array. `["Sites.Read.All"` fails on three counts.
 */
const FORBIDDEN_IN_SCOPE = /[\s"'[\]{},\\]/

/** Whether a single token is shaped like a delegated OAuth scope. */
export function isScopeToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && !FORBIDDEN_IN_SCOPE.test(token)
}

/** What a stored scope value turned out to be. */
export interface ScopeListReading {
  /** The usable scopes, de-duplicated, first-seen order preserved. */
  readonly scopes: readonly string[]
  /**
   * Entries that are not scopes, as they were stored (stringified). Carried
   * back so a surface can show what it refused instead of silently dropping
   * it — silence is what let the original fault reach Microsoft.
   */
  readonly rejected: readonly string[]
  /**
   * True when the VALUE ITSELF was not a list (most often a JSON string).
   * Distinct from "a list containing bad entries": one is a shape error at
   * the field, the other is a content error inside it.
   */
  readonly malformed: boolean
}

const EMPTY: ScopeListReading = { scopes: [], rejected: [], malformed: false }

/**
 * Read a stored scope value. Never throws, for any input.
 *
 * `undefined`/`null`/`[]` are an empty list, not a fault — an atom that needs
 * no delegated permission is a normal atom.
 */
export function readScopeList(value: unknown): ScopeListReading {
  if (value === undefined || value === null) return EMPTY

  if (!Array.isArray(value)) {
    // A string is NOT split — splitting is what manufactures invalid tokens.
    return { scopes: [], rejected: [safeShow(value)], malformed: true }
  }

  const scopes: string[] = []
  const rejected: string[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (isScopeToken(entry)) {
      if (!seen.has(entry)) {
        seen.add(entry)
        scopes.push(entry)
      }
    } else {
      rejected.push(safeShow(entry))
    }
  }

  return { scopes, rejected, malformed: false }
}

/** Render any value for display without throwing (Symbols throw on `String`). */
function safeShow(value: unknown): string {
  try {
    return typeof value === 'string' ? value : String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}
