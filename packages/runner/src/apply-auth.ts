/**
 * Who is signed in, put where the app's shell shows it.
 *
 * TWO PATHS, ONE SOURCE OF TRUTH.
 *
 *  - An app that declares `navigation.account` gets an `account` prop injected
 *    into every block of the declared placement (`navbar`, `bottom-bar`,
 *    `app-rail`). The block draws sign-in / the visitor / sign-out in the
 *    app's own appearance. This is the path new apps take.
 *  - An app that declares nothing keeps the legacy behaviour: the navbar's
 *    static greeting placeholder ("Hoş geldin, …" / "Welcome, …") and
 *    `avatarName` are swapped for the real visitor.
 *
 * Both read the visitor from EITHER door (`accountUserFrom`), so a visitor who
 * came in through the host door (password, or a host provider door) reaches
 * the navbar just like a PKCE bridge session.
 *
 * @module @pwfabric/runner/apply-auth
 */

import type { AuthSession } from '@pwfabric/runtime/auth'
import type { AppSession } from './app-session.js'
import { rewriteHrefs, type ToHref } from './helpers.js'
import { copyFor, type RunnerLocale } from './copy.js'
import type {
  AccountPlacement,
  AccountProp,
  PwappAccountDeclaration,
  SurfaceBlockNode,
} from './types.js'

export type ApplyAuthLocale = RunnerLocale

export interface ApplyAuthOptions {
  /** Content locale of the delivered app. Defaults to 'en'. */
  locale?: ApplyAuthLocale
}

/** What the shell may show about a signed-in visitor. Every field optional. */
export interface AccountUser {
  readonly name?: string
  readonly email?: string
  readonly avatarSrc?: string
}

const GREETING_PREFIXES = ['Hoş geldin', 'Welcome'] as const

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * The visitor, from whichever door let them in — or null when neither did.
 *
 * The platform session wins when both exist, for the same reason
 * `doorHeaders` presents it first: it is the door this deployment issued and
 * can revoke. A session with no profile is still a signed-in visitor (`{}`).
 */
export function accountUserFrom(doors: {
  readonly appSession?: AppSession | null | undefined
  readonly bridgeSession?: AuthSession | null | undefined
}): AccountUser | null {
  const app = doors.appSession
  if (app) {
    const p = app.principal
    return {
      ...(nonEmpty(p?.displayName) ? { name: p.displayName } : {}),
      ...(nonEmpty(p?.email) ? { email: p.email } : {}),
      ...(nonEmpty(p?.avatarUrl) ? { avatarSrc: p.avatarUrl } : {}),
    }
  }
  const session = doors.bridgeSession
  if (session) {
    const u = session.user
    const picture = u?.claims?.['picture']
    return {
      ...(nonEmpty(u?.name) ? { name: u.name } : {}),
      ...(nonEmpty(u?.email) ? { email: u.email } : {}),
      ...(nonEmpty(picture) ? { avatarSrc: picture } : {}),
    }
  }
  return null
}

/**
 * The `account` prop for the declared shell block.
 *
 * `profileHref` and `links[].href` go through `rewriteHrefs` — the helper the
 * navbar montage uses — so a catalog's `/profile/` lands on the same router
 * form (hash or base-prefixed path) as every other link in the app, and an
 * absolute URL is left alone.
 */
export function buildAccountProp(input: {
  readonly declaration: PwappAccountDeclaration
  readonly user: AccountUser | null
  readonly entry: string
  readonly toHref: ToHref
  readonly locale?: ApplyAuthLocale | undefined
}): AccountProp {
  const { declaration, user, entry, toHref } = input
  const labels = copyFor(input.locale).account
  const profileHref = nonEmpty(declaration.profileHref)
    ? rewriteHrefs({ href: declaration.profileHref }, entry, toHref).href
    : undefined
  const links = Array.isArray(declaration.links)
    ? rewriteHrefs(
        declaration.links.map((l) => ({ label: l.label, href: l.href })),
        entry,
        toHref
      )
    : undefined
  return {
    state: user ? 'signed-in' : 'signed-out',
    ...(user?.name ? { name: user.name } : {}),
    ...(user?.email ? { email: user.email } : {}),
    ...(user?.avatarSrc ? { avatarSrc: user.avatarSrc } : {}),
    ...(profileHref ? { profileHref } : {}),
    ...(links ? { links } : {}),
    signInLabel: labels.signIn,
    signOutLabel: labels.signOut,
    profileLabel: labels.profile,
  }
}

/** Inject `account` into every block of `placement`, at any depth. Non-mutating. */
export function applyAccountToSurface(
  blocks: SurfaceBlockNode[],
  account: AccountProp,
  placement: AccountPlacement
): SurfaceBlockNode[] {
  const walk = (block: SurfaceBlockNode): SurfaceBlockNode => {
    const patched: SurfaceBlockNode =
      block.type === placement ? { ...block, props: { ...(block.props ?? {}), account } } : block
    if (!Array.isArray(patched.children)) return patched
    return { ...patched, children: patched.children.map(walk) }
  }
  return blocks.map(walk)
}

// ============================================================
// THE GREETING FALLBACK (apps with no account slot)
// ============================================================

function displayName(user: AccountUser, locale: ApplyAuthLocale): string {
  return user.name ?? user.email ?? copyFor(locale).account.fallbackName
}

/**
 * Only the greeting rightInfo entry (its value starts with the receipt's own
 * greeting placeholder text) and avatarName are overridden — every other
 * navbar prop (weather/FX rightInfo chips, logoText, links) is left exactly
 * as the receipt authored it.
 */
function patchNavbarProps(
  props: Record<string, unknown>,
  user: AccountUser,
  locale: ApplyAuthLocale
): Record<string, unknown> {
  const name = displayName(user, locale)
  const rightInfo = Array.isArray(props.rightInfo)
    ? (props.rightInfo as Array<Record<string, unknown>>).map((item) => {
        if (typeof item.value !== 'string') return item
        const prefix = GREETING_PREFIXES.find((p) => (item.value as string).startsWith(p))
        return prefix ? { ...item, value: `${prefix}, ${name}` } : item
      })
    : props.rightInfo
  return { ...props, rightInfo, avatarName: name }
}

/** The greeting patch, for a visitor from either door. Non-mutating. */
export function applyGreeting(
  blocks: SurfaceBlockNode[],
  user: AccountUser,
  locale: ApplyAuthLocale = 'en'
): SurfaceBlockNode[] {
  const walk = (block: SurfaceBlockNode): SurfaceBlockNode => {
    const patched: SurfaceBlockNode =
      // a navbar without props is patched too — see the same gate in helpers.assembleNav.
      block.type === 'navbar'
        ? { ...block, props: patchNavbarProps(block.props ?? {}, user, locale) }
        : block
    if (!Array.isArray(patched.children)) return patched
    return { ...patched, children: patched.children.map(walk) }
  }
  return blocks.map(walk)
}

/**
 * The account control, or the greeting fallback, for one rendered page.
 *
 * THE SLOT IS DRAWN ONLY WHERE THERE IS A DOOR. `navigation.account` says where
 * the control goes; it does not say the app signs anyone in. An app with no
 * `auth.json` (a world without the identity pack builds exactly these) used to
 * get the control anyway, and signed out it is a "Sign in" button that opens
 * onto "no provider is configured". With no door the declared slot is left
 * empty — the block draws no account — and the greeting fallback applies as it
 * does for an app that declares no slot at all. `door` is `hasDoor` from the
 * account controller, decided once per boot by the runner.
 *
 * With a door this is exactly the inline branch `runApp` had before.
 */
export function applyAccountControl(
  blocks: SurfaceBlockNode[],
  input: {
    readonly declaration: PwappAccountDeclaration | undefined
    readonly door: boolean
    readonly user: AccountUser | null
    readonly entry: string
    readonly toHref: ToHref
    readonly locale?: ApplyAuthLocale | undefined
  }
): SurfaceBlockNode[] {
  const { declaration, user } = input
  if (declaration && input.door) {
    const account = buildAccountProp({
      declaration,
      user,
      entry: input.entry,
      toHref: input.toHref,
      locale: input.locale,
    })
    return applyAccountToSurface(blocks, account, declaration.placement)
  }
  // No slot, or a slot with no door behind it: the legacy greeting patch.
  return user ? applyGreeting(blocks, user, input.locale ?? 'en') : blocks
}

/**
 * The original bridge-session entry point, kept for hosts that call it.
 * Logged-out render is untouched.
 */
export function applyAuthToSurface<T extends { blocks: SurfaceBlockNode[] }>(
  surface: T,
  session: AuthSession | undefined,
  options?: ApplyAuthOptions
): T {
  if (!session?.user) return surface
  const user = accountUserFrom({ bridgeSession: session }) ?? {}
  return { ...surface, blocks: applyGreeting(surface.blocks, user, options?.locale ?? 'en') }
}
