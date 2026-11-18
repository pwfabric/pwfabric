/**
 * A page's FIRST FRAME — what the renderer draws before anything has
 * arrived — computed the same way by the runner and by the build.
 *
 * WHY ONE FUNCTION. `pwf build` renders each page's first frame to HTML and
 * writes it into the shell (pwapp-format §2.5, the static first paint), and
 * the runner HYDRATES that HTML instead of drawing the page again. Hydration
 * only holds when the browser's first render is the build's, node for node:
 * the same blocks (hrefs rewritten, navbar and footer assembled, the account
 * control), the same capabilities, the same render options that change the
 * markup. Both sides build them here.
 *
 * THE FIRST FRAME IS THE SAME FOR EVERY VISITOR:
 * - nobody signed in (`__auth` signed out, no error), with the ways in the
 *   app declares ({@link firstFrameDoorOf});
 * - nothing read from the address (the page's `initialState` as written);
 * - every fetched source loading, a static source's rows in place, and a
 *   source the runtime settles without a request settled: idle (an empty
 *   record key), or refused as `unauthenticated` (`requiresSession`) —
 *   the runtime's first render decides both (data-protocol §1.1, §2.6);
 * - the phone layout, `xs` ({@link STATIC_VIEWPORT}): mobile first;
 * - the app's locale, `en` when it names none ({@link firstFrameLocale}).
 *
 * Whatever the real visit differs in — a visitor who is signed in, a wider
 * window, cached rows — the runner applies right after hydration, as an
 * update of the same tree. A visit whose address seeds the page's state
 * (`?id=12`) is not painted from the build at all (the shell's first-paint
 * script leaves the root empty): that page's first frame is not the build's.
 *
 * @module @pwfabric/runner/first-frame
 */

import { accountUserFrom, applyAccountControl, type AccountUser } from './apply-auth.js'
import { authStateOf } from './auth-state.js'
import { assembleFooter, assembleNav, linkHrefFor, rewriteHrefs, seedStateFromQuery, type ToHref } from './helpers.js'
import type { RunnerMessages } from './messages.js'
import type { PwappNavigation, PwappProject, SurfaceReceipt } from './types.js'

/** The breakpoint the static first paint is drawn at: the phone's (mobile first). */
export const STATIC_VIEWPORT = 'xs'

/** Below this window width the breakpoint is {@link STATIC_VIEWPORT} (contracts BREAKPOINTS: `sm` starts at 640). */
export const STATIC_VIEWPORT_MAX_WIDTH = 639

/** The attribute on `#pw-root` naming the page whose first frame it holds. */
export const STATIC_PAGE_ATTR = 'data-pw-static'

/** What a page's blocks are assembled from, beside its receipt. */
export interface PageContext {
  readonly entry: string
  readonly toHref: ToHref
  readonly navigation: PwappNavigation | null | undefined
  /** Whether the app has a way in at all (`hasDoor`). */
  readonly door: boolean
  /** Who is signed in; `null` in the first frame. */
  readonly user: AccountUser | null
  readonly messages: RunnerMessages
}

/**
 * A page's blocks as the visitor sees them: internal hrefs in the active
 * router's form, the navbar's links, the footer band, the account control.
 */
export function pageBlocksOf(
  raw: SurfaceReceipt['blocks'],
  pageKey: string,
  ctx: PageContext
): SurfaceReceipt['blocks'] {
  let blocks = rewriteHrefs(raw, ctx.entry, ctx.toHref)
  blocks = assembleNav(blocks, ctx.navigation, ctx.entry, ctx.toHref)
  blocks = assembleFooter(blocks, ctx.navigation, pageKey, ctx.entry, ctx.toHref)
  // The declared slot is drawn only when the app has a door; an app without
  // one gets the greeting fallback, never a dead "Sign in".
  return applyAccountControl(blocks, {
    declaration: ctx.navigation?.account,
    door: ctx.door,
    user: ctx.user,
    entry: ctx.entry,
    toHref: ctx.toHref,
    messages: ctx.messages,
  })
}

/** The surface the renderer is handed for a page. */
export interface PageSurface {
  readonly blocks: SurfaceReceipt['blocks']
  readonly appearance: SurfaceReceipt['appearance']
  readonly capabilities: NonNullable<SurfaceReceipt['capabilities']>
  readonly title?: string
  readonly description?: string
}

/**
 * The surface of page `pageKey`: its blocks (see {@link pageBlocksOf}), its
 * state seeded from `params`, and the links in its capabilities' config (a
 * form's successRedirect, a behavior's navigate url) rewritten like the
 * blocks' hrefs. capabilities MUST travel: the data-bound renderer derives
 * its sources from them.
 */
export function pageSurfaceOf(
  receipt: SurfaceReceipt,
  pageKey: string,
  params: URLSearchParams,
  ctx: PageContext
): PageSurface {
  const seeded = seedStateFromQuery(receipt, params)
  return {
    blocks: pageBlocksOf(receipt.blocks, pageKey, ctx),
    appearance: receipt.appearance,
    capabilities: rewriteHrefs(seeded.capabilities, ctx.entry, ctx.toHref) ?? [],
    ...(typeof receipt.title === 'string' ? { title: receipt.title } : {}),
    ...(typeof receipt.description === 'string' ? { description: receipt.description } : {}),
  }
}

/** The ways in the first frame shows: the app's declaration, never the deployment's door. */
export interface FirstFrameDoor {
  /** Whether the app has a way in at all (the account control's slot is drawn). */
  readonly door: boolean
  /** `__auth.methods`, in the order the runner lists them. */
  readonly methods: readonly string[]
  /** `__auth.registration`. */
  readonly registration: 'open' | 'invite' | 'closed'
}

/**
 * THE DOOR THE FIRST FRAME SHOWS — read from `project.json` `identity`, what
 * the app DECLARES (envelope §2), not from `auth.json`.
 *
 * `auth.json` holds the deployment's addresses: `pwf build` writes none, and
 * the publisher, `pwf run` or `pwf dev` puts its own in. Read from there, the
 * build painted an app with a password door as an app with no door (the
 * navbar's plain "Ticket" item) while the browser, which has the host's
 * `auth.json`, drew the signed-out "Sign in" — and the hydration failed
 * (conference-companion, React #418). Read from the declaration, the build
 * and the hydrating render draw the same control; a deployment that ships
 * no door after all (`identity.door: false`) loses it in the update after
 * hydration, like any other way the visit differs.
 */
export function firstFrameDoorOf(project: PwappProject): FirstFrameDoor {
  const identity = project.identity
  const registration = identity?.registration ?? (identity?.required === true ? 'closed' : 'open')
  if (!identity) return { door: false, methods: [], registration }
  if (identity.topology === 'external') return { door: true, methods: ['issuer'], registration }
  const declared = (identity.methods ?? []).filter((m): m is string => typeof m === 'string' && m !== '')
  // The runner's order (auth-state.ts authMethodsOf): the password door first.
  const methods = [...(declared.includes('password') ? ['password'] : []), ...declared.filter((m) => m !== 'password')]
  return { door: methods.length > 0, methods: [...new Set(methods)], registration }
}

/** `__auth` in the first frame: nobody signed in, nothing to report, the declared ways in. */
export function firstFrameAuthState(door: FirstFrameDoor): ReturnType<typeof authStateOf> {
  return authStateOf({ appSession: null, bridgeSession: null, methods: door.methods, registration: door.registration, error: null })
}

/**
 * The locale the first frame is written in: the app's (`plan.locale`), or
 * `en` for an app that names none. Without one, the browser formats numbers
 * and dates in the VISITOR's language — which a build cannot know, and a
 * build must not write in its own machine's — so the first frame is written
 * in English and the visitor's formats follow right after hydration.
 */
export function firstFrameLocale(project: PwappProject): string {
  return typeof project.locale === 'string' && project.locale ? project.locale : 'en'
}

/** The first frame's account user: nobody. Named so both sides read it from one place. */
export const FIRST_FRAME_USER: AccountUser | null = accountUserFrom({ appSession: null, bridgeSession: null })

/**
 * The render options that change the first frame's markup, beside the
 * surface. The runner adds the rest (the data path, the address, the
 * callbacks); none of those draws anything before a fetch settles.
 */
export function firstFrameOptions(input: {
  readonly project: PwappProject
  readonly appearanceRef: unknown
  readonly receipt: SurfaceReceipt
  readonly entry: string
  readonly toHref: ToHref
}): Record<string, unknown> {
  const { project } = input
  return {
    appearance: input.appearanceRef ?? input.receipt.appearance ?? {},
    // PAINT FIRST, FILL IN AFTER: the chrome, headings and static cards are
    // in the receipt already; only the lists wait.
    loadingStrategy: 'immediate',
    // A link whose page is an expression is written for the router once its
    // value is known (rewriteHrefs left it as written).
    linkHref: linkHrefFor(input.entry, input.toHref),
    ...(typeof project.locale === 'string' && project.locale ? { locale: project.locale } : {}),
    // ...and its words, for the words a block draws itself (`ui.*`).
    ...(project.messages ? { messages: project.messages } : {}),
  }
}
