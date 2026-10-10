/**
 * Source screening — what a block or capability source may CONTAIN.
 *
 * ── THIS IS A HYGIENE CHECK, NOT A SECURITY BOUNDARY. ──
 * It is a regex denylist over comment- and literal-masked text. Aliasing a global through a binding (`const g = globalThis;
 * g['fe' + 'tch']`), `Reflect.get`, `top[...]` and similar spellings walk past
 * it — the tests pin several as known gaps. Running untrusted block code safely
 * is the HOST's job: an isolated origin or sandboxed iframe/worker for block
 * bundles, plus a Content Security Policy. Do not treat a passing screen as
 * permission to run a module with the host's privileges.
 *
 * Authorisation ("may this caller add a block") is the host's business. This
 * answers the different question: once a source string reaches the compiler,
 * may the module it becomes reach the ambient browser capabilities that turn
 * "renders a component" into "reads your session and ships it somewhere"?
 *
 * A source that arrives as content — written by a model steered by text an
 * attacker can influence, or posted directly by a caller — is compiled and then
 * executed by every renderer that loads it, on the host's own origin, inside an
 * authenticated session. So the module is constrained: it may render from its
 * props; it may not reach network egress, credential stores or code
 * construction.
 *
 * This narrows the blast radius. It does NOT stop prompt injection — see
 * {@link screenSource}'s KNOWN GAPS for exactly what still gets through.
 *
 * The compiler does not call this for you: `compileAtom` compiles what it is
 * given. A host that compiles untrusted source screens it first, and screens
 * every companion the source reaches — `collectCompanions` does both.
 *
 * @module @pwfabric/compiler/screen
 */

import { blockBundleExternals } from '@pwfabric/core'

/**
 * Module specifiers a screened source may import at VALUE level.
 *
 * DERIVED from the host import list (`blockBundleExternals()` over
 * `BLOCK_HOST_IMPORTS` in `@pwfabric/core`), so the screen and
 * the bundler can never disagree. A narrower hand-written list would refuse
 * real packs, which import the runtime for the event bus, surface id and
 * connection contexts. A specifier the bundler
 * leaves external and every host maps for compiled blocks is a specifier the
 * screen admits; one list says both.
 *
 * What still keeps a screened module from network egress, credential stores
 * and code construction is layer 2 (the forbidden-capability scan) and the
 * host's sandbox — not the narrowness of this list.
 */
export const SCREEN_IMPORT_ALLOWLIST: readonly string[] = Object.freeze([...blockBundleExternals()])

export type ScreenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly string[] }

/**
 * Browser capabilities a screened source may not reach.
 *
 * Every entry was checked against a large set of real block components before
 * being added: it appears in none of them, so none is the price of a
 * legitimate block. The list is the "turns rendering into exfiltration or
 * execution" set, not a general-purpose JS denylist:
 *
 *  - arbitrary code construction (`eval`, `Function`, `.constructor(...)`)
 *  - network egress (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
 *    `sendBeacon`, `importScripts`, `Worker`, `RTCPeerConnection`)
 *  - cross-context messaging (`postMessage`)
 *  - credential/state reads (`document.cookie`, `localStorage`,
 *    `sessionStorage`, `indexedDB`, `caches`, `process.env`)
 *  - document rewriting (`document.write`/`writeln`/`domain`,
 *    `createElement('script')`)
 *  - the obvious spellings-around: computed member access on a global
 *    (`window[...]`, `globalThis[...]`, `self[...]`, `document[...]`) and
 *    module loading at run time (`import()`, `require()`).
 *
 * Patterns whose evidence lives INSIDE a string literal (the `createElement`
 * pair) run against the comment-masked-but-literals-intact source instead. They
 * are weak by construction — `createElement(tag)` with a computed `tag` walks
 * straight past — but the literal spelling is the one a model actually emits.
 */
const FORBIDDEN_SOURCE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function()'],
  [/\bFunction\s*\(/, 'Function() as a constructor/call'],
  [/\.\s*constructor\s*[[(]/, '.constructor access (Function-constructor escape)'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon()'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\b(?:Shared)?Worker\s*\(/, 'Worker()'],
  [/\bRTCPeerConnection\b/, 'RTCPeerConnection'],
  [/\bpostMessage\s*\(/, 'postMessage()'],
  [/\bdocument\s*\.\s*cookie\b/, 'document.cookie'],
  [/\bdocument\s*\.\s*(?:write|writeln|domain)\b/, 'document.write / writeln / domain'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/\bcaches\s*\./, 'caches (CacheStorage)'],
  [/\bprocess\s*\.\s*env\b/, 'process.env'],
  [/\b(?:window|globalThis|self|document)\s*\[/, 'computed member access on a global object'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
] as const
const FORBIDDEN_LITERAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcreateElement\s*\(\s*['"`]script['"`]/, "createElement('script')"],
  [/\bcreateElement\s*\(\s*['"`]iframe['"`]/, "createElement('iframe')"],
] as const

/**
 * Blank out comments and (optionally) string/template/regex literal CONTENT,
 * preserving byte offsets and newlines so reported line numbers stay true.
 *
 * Why this exists rather than a raw `source.includes('fetch(')`: a shipped
 * first-party block's JSDoc says `same-origin fetch('/api/orders')`. A scan that
 * did not strip comments would refuse a block for describing itself. Template
 * SUBSTITUTIONS (`${...}`) are deliberately kept live — that is real code.
 *
 * The literal scanner must run even when `blankLiterals` is false, because a
 * `//` or a `/` inside a string would otherwise be misread as a comment or a
 * regex and swallow the rest of the file.
 */
export function maskSource(src: string, blankLiterals: boolean): string {
  let out = ''
  let i = 0
  let prev = '\n'
  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ')
  const emit = (ch: string): void => {
    out += blankLiterals ? blank(ch) : ch
  }

  while (i < src.length) {
    const two = src.slice(i, i + 2)

    if (two === '//') {
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (two === '/*') {
      while (i < src.length && src.slice(i, i + 2) !== '*/') {
        out += blank(src[i] as string)
        i++
      }
      out += '  '
      i += 2
      continue
    }

    const c = src[i] as string

    if (c === "'" || c === '"') {
      emit(c)
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          emit(src[i] as string)
          i++
          if (i >= src.length) break
        }
        emit(src[i] as string)
        i++
      }
      if (i < src.length) {
        emit(src[i] as string)
        i++
      }
      prev = c
      continue
    }

    if (c === '`') {
      emit(c)
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          emit(src[i] as string)
          i++
          if (i >= src.length) break
          emit(src[i] as string)
          i++
          continue
        }
        if (src[i] === '`') {
          emit(src[i] as string)
          i++
          break
        }
        if (src.slice(i, i + 2) === '${') {
          // Live code — copy verbatim, tracking brace depth back to the `}`.
          out += '${'
          i += 2
          let depth = 1
          while (i < src.length && depth > 0) {
            const s = src[i] as string
            if (s === '{') depth++
            else if (s === '}') depth--
            out += s
            i++
          }
          continue
        }
        emit(src[i] as string)
        i++
      }
      prev = '`'
      continue
    }

    // Regex literal: a `/` in a position where a value may start.
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>\n]/.test(prev)) {
      emit(c)
      i++
      while (i < src.length && src[i] !== '/' && src[i] !== '\n') {
        if (src[i] === '\\') {
          emit(src[i] as string)
          i++
          if (i >= src.length) break
        }
        emit(src[i] as string)
        i++
      }
      if (i < src.length && src[i] === '/') {
        emit(src[i] as string)
        i++
      }
      while (i < src.length && /[dgimsuy]/.test(src[i] as string)) {
        emit(src[i] as string)
        i++
      }
      prev = '/'
      continue
    }

    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

const IMPORT_FROM_RE = /(?:^|[\n;])[ \t]*(import|export)\b([ \t]+type\b)?([^;]*?)\bfrom[ \t]*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|[\n;])[ \t]*import[ \t]*['"]([^'"]+)['"]/g

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

/**
 * Where the statement itself starts inside an import match. The import
 * patterns open on the newline or `;` that precedes a statement, so the match
 * index can sit one line early — or, at the very start of the file, not early
 * at all. Skipping the separators gives the statement's own line either way.
 */
function statementIndex(src: string, matchIndex: number): number {
  let i = matchIndex
  while (i < src.length && /[\n; \t]/.test(src[i] as string)) i++
  return i
}

/** Options for {@link screenSource}. */
export interface ScreenOptions {
  /**
   * The door for shared pack code. A value-level relative import is allowed
   * only when this returns true for the specifier — i.e. the caller says it
   * resolves to a file it will ship as a companion (`atoms/lib/*` or a
   * `_shared-*` sibling) and will screen that file with this same function.
   * Without the option every relative value import is rejected.
   */
  readonly allowRelativeImport?: (spec: string) => boolean
}

/**
 * Screen one source before it is allowed anywhere near the compiler. Returns
 * every violation found (not just the first) so a repair loop gets a complete,
 * actionable message.
 *
 * TWO LAYERS:
 *  1. IMPORT ALLOWLIST — every value-level `import`/`export ... from` and bare
 *     `import '...'` specifier must be in {@link SCREEN_IMPORT_ALLOWLIST}.
 *     Relative specifiers are rejected at value level unless
 *     {@link ScreenOptions.allowRelativeImport} admits them, but permitted on
 *     `import type` / `export type` statements, which the compiler erases.
 *  2. ESCAPE SCAN — the forbidden-capability patterns over the
 *     comment-and-literal-masked source.
 *
 * ── KNOWN GAPS. Read these before believing this closes anything. ──
 *
 * This is a DENYLIST over source text, not a sandbox, and it is deliberately
 * incomplete. It does not stop:
 *
 *  - **Prompt injection itself.** Attacker-controlled text still steers the
 *    model. All this changes is what the resulting module is allowed to do.
 *  - **`dangerouslySetInnerHTML` / `innerHTML`.** 30 of the 100 first-party
 *    blocks use `dangerouslySetInnerHTML` for inline SVG icon paths, so it is
 *    allowed — a screened block CAN inject arbitrary markup.
 *  - **Navigation-based exfiltration.** `window.location.href = ...` is used by
 *    first-party blocks for link handling, so it is allowed; a block can
 *    navigate the tab to an attacker URL with data in the query.
 *  - **Rendering hostile content into props/children**, phishing UI, and any
 *    purely-visual deception.
 *  - **Sufficiently indirect spellings.** The scan is textual: identifiers
 *    assembled at run time, property names built from arrays, aliasing a global
 *    through a permitted binding, or `top`/`parent` (excluded from the
 *    computed-access rule because they are common local names) can still reach
 *    a banned capability. Closing that class needs an execution sandbox (CSP +
 *    an isolated origin/worker for block bundles), not a string scan.
 */
export function screenSource(source: string, opts?: ScreenOptions): ScreenResult {
  const violations: string[] = []

  // Layer 2 runs over fully-masked source (comments + literal content gone).
  const code = maskSource(source, true)
  for (const [pattern, label] of FORBIDDEN_SOURCE_PATTERNS) {
    const m = pattern.exec(code)
    if (m) {
      violations.push(`line ${lineOf(code, m.index)}: ${label} is not permitted in a block component`)
    }
  }

  // Layer 1 runs over comment-masked-but-literals-intact source: the
  // specifier itself lives inside quotes, but a commented-out import must not
  // count. The literal-evidence patterns share that view.
  const withStrings = maskSource(source, false)
  for (const [pattern, label] of FORBIDDEN_LITERAL_PATTERNS) {
    const lm = pattern.exec(withStrings)
    if (lm) {
      violations.push(
        `line ${lineOf(withStrings, lm.index)}: ${label} is not permitted in a block component`
      )
    }
  }

  const specs: Array<{ typeOnly: boolean; spec: string; index: number }> = []
  IMPORT_FROM_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMPORT_FROM_RE.exec(withStrings)) !== null) {
    specs.push({ typeOnly: m[2] !== undefined, spec: m[4] as string, index: m.index })
  }
  BARE_IMPORT_RE.lastIndex = 0
  while ((m = BARE_IMPORT_RE.exec(withStrings)) !== null) {
    specs.push({ typeOnly: false, spec: m[1] as string, index: m.index })
  }

  for (const s of specs) {
    if (s.typeOnly) continue
    const line = lineOf(withStrings, statementIndex(withStrings, s.index))
    if (s.spec.startsWith('.') && opts?.allowRelativeImport?.(s.spec)) continue
    if (s.spec.startsWith('.') || s.spec.startsWith('/')) {
      violations.push(
        `line ${line}: relative import '${s.spec}' — a generated block is bundled as a single self-contained file; only \`import type\` may reference a sibling module`
      )
    } else if (!SCREEN_IMPORT_ALLOWLIST.includes(s.spec)) {
      violations.push(
        `line ${line}: import '${s.spec}' is outside the block import allowlist (${SCREEN_IMPORT_ALLOWLIST.join(', ')})`
      )
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

/** Alternative name for `screenSource`. */
export const screenBlockSource = screenSource
/** Alternative name for `SCREEN_IMPORT_ALLOWLIST`. */
export const BLOCK_SOURCE_IMPORT_ALLOWLIST = SCREEN_IMPORT_ALLOWLIST
