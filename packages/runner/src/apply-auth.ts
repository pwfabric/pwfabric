/**
 * Who is signed in, put where the app's shell shows it.
 *
 * An app that declares `navigation.account` gets an `account` prop injected
 * into every block of the declared placement (`navbar`, `bottom-bar`,
 * `app-rail`). The block draws sign-in / the visitor / sign-out in the app's
 * own appearance, with the app's words (`account.*` messages).
 *
 * The runner rewrites none of the app's own text. A greeting the app writes
 * in its navbar is the app's, bound to the visitor with `{{me.name}}`; the
 * runner used to find "Welcome, …" by its English prefix and overwrite it,
 * which no app in another language could ever opt into or out of.
 *
 * The visitor is read from EITHER door (`accountUserFrom`), so a visitor who
 * came in through the host door (password, or a host provider door) reaches
 * the account control just like a PKCE bridge session.
 *
 * @module @pwfabric/runner/apply-auth
 */

import type { AuthSession } from '@pwfabric/runtime/auth'
import type { AppSession } from './app-session.js'
import { rewriteHrefs, type ToHref } from './helpers.js'
import { NO_MESSAGES, type RunnerMessages } from './messages.js'
import type {
  AccountPlacement,
  AccountProp,
  PwappAccountDeclaration,
  SurfaceBlockNode,
} from './types.js'

/** What the shell may show about a signed-in visitor. Every field optional. */
export interface AccountUser {
  readonly name?: string
  readonly email?: string
  readonly avatarSrc?: string
}

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
  /** The app's words (`account.*`). Default: none (every word empty). */
  readonly messages?: RunnerMessages | undefined
}): AccountProp {
  const { declaration, user, entry, toHref } = input
  const say = input.messages ?? NO_MESSAGES
  const who = user?.name ?? user?.email
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
    signInLabel: say('account.signIn'),
    signOutLabel: say('account.signOut'),
    profileLabel: say('account.profile'),
    ...(user && who ? { greetingLabel: say('account.greeting', { name: who }) } : {}),
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

/**
 * The account control for one rendered page.
 *
 * THE SLOT IS DRAWN ONLY WHERE THERE IS A DOOR. `navigation.account` says where
 * the control goes; it does not say the app signs anyone in. An app with no
 * `auth.json` (a world without the identity pack builds exactly these) used to
 * get the control anyway, and signed out it is a "Sign in" button that opens
 * onto "no provider is configured". With no door the declared slot is left
 * empty — the block draws no account. `door` is `hasDoor` from the account
 * controller, decided once per boot by the runner.
 */
export function applyAccountControl(
  blocks: SurfaceBlockNode[],
  input: {
    readonly declaration: PwappAccountDeclaration | undefined
    readonly door: boolean
    readonly user: AccountUser | null
    readonly entry: string
    readonly toHref: ToHref
    readonly messages?: RunnerMessages | undefined
  }
): SurfaceBlockNode[] {
  const { declaration, user } = input
  if (declaration && input.door) {
    const account = buildAccountProp({
      declaration,
      user,
      entry: input.entry,
      toHref: input.toHref,
      messages: input.messages,
    })
    return applyAccountToSurface(blocks, account, declaration.placement)
  }
  return blocks
}
