/**
 * runApp — the pwapp runner boot. Productized port of the proven demo
 * runner (runner.js): reads a
 * pwpack source envelope at RUNTIME (folder path or absolute URL), sets up a
 * hash/path router, per route fetches the receipt, rewrites internal hrefs,
 * does navigation assembly (navbar links from navigation.json), and hands the render to
 * embed.js's `PWFabric.render` fat mode — the same proven engine as the
 * static export. Plus the real-runner slice the demo deferred: the PKCE
 * auth bridge (auth.json) with token-backed entity facades.
 *
 * Base-independence law: every path is relative — the package works at a
 * host root or any sub-path; platform publish paths (`/p/…`) never leak in.
 *
 * @module @pwfabric/runner/run-app
 */

// TYPES ONLY from the runtime at load: runner.js loads before the renderer
// that seeds the runtime for the page (renderer.ts), so a value it needs is
// imported once the renderer is in (see `engineConnections`).
import type {
  SurfaceAddress,
  EntityConnector,
  ConnectorConnectionBinding,
  SurfaceConnection,
  SurfaceConnectionsValue,
} from '@pwfabric/runtime'
import type { RunAppOptions, SurfaceReceipt } from './types.js'
import { loadRenderer, warmBlockModules } from './renderer.js'
import { applyCanonical, applyDescription, canonicalOf } from './description.js'
import { composeTitle, doorHeaders, fetchJson, queryStateSeed, receiptFilesOf, rewriteHrefs, seedStateFromQuery, withVersion } from './helpers.js'
import {
  FIRST_FRAME_USER,
  PAGE_ATTR,
  STATIC_LAYOUT_ID,
  STATIC_PAGE_ATTR,
  STATIC_VIEWPORT,
  fillSharedStyles,
  firstFrameAuthState,
  firstFrameDoorOf,
  firstFrameLocale,
  firstFrameOptions,
  pageBlocksOf,
  pageSurfaceOf,
} from './first-frame.js'
import { createRouter, resolveRouterMode, type RouteChange } from './router.js'
import { authDeclarationNote, createAuthBridge, type AuthBridge } from './auth.js'
import { accountUserFrom } from './apply-auth.js'
import { createAccountController, hasDoor, type SignInMode } from './account-controller.js'
import { authErrorCode, authMethodsOf, authStateOf } from './auth-state.js'
import { applyShellDarkMode, shellDarkThemeVars, shellModePolicy, shellThemeVars } from './shell-theme.js'
import { projectAppearanceRef } from './appearance-ref.js'
import {
  buildEntityFacade,
  extractEntityTypes,
  mirrorDeclaredEngines,
  needsNoIdentity,
  withDeclaredEngines,
} from './entity-facade.js'
import { mountSessionPill } from './session-pill.js'
import { sessionDataCache } from './data-cache.js'
import { mountSignInGate, isGated } from './sign-in-gate.js'
import {
  clearAppSession,
  startSocialSignIn,
  withProfile,
  writeAppSession,
  type AppSession,
} from './app-session.js'
import { bootSession } from './boot-session.js'
import { loadEnvelope } from './load-envelope.js'
import { authErrorMessage, runnerMessages } from './messages.js'
import { renderNotFound } from './not-found.js'
import { isOwnApiRef, ownApiBaseOf } from './api-base.js'
import { ownRecordsReceipt } from './own-records.js'
import { receiptSurfaceId, startPreviewSession, type PreviewPage, type PreviewSession } from './preview-session.js'
import type { PreviewSurface } from './preview-bridge.js'
import { createConsent } from './consent.js'
import { createColorScheme } from './color-scheme.js'
import { assemblePage } from './layout.js'

export { projectAppearanceRef } from './appearance-ref.js'

export async function runApp(opts: RunAppOptions = {}): Promise<void> {
  const source = String(opts.source ?? './pwpack').replace(/\/+$/, '')
  const blocksBase = String(opts.blocks ?? './blocks/').replace(/\/+$/, '')

  const enginesBase = String(opts.engines ?? './engines').replace(/\/+$/, '')
  const rendererUrl = String(opts.renderer ?? './assets/embed.js')
  // `auth.json` is asked for only when `project.json` declares an identity
  // (see load-envelope.ts); every other file in parallel, as before.
  const { project, navigation, appearance, auth, connections, blockManifest, engineManifest } = await loadEnvelope(
    { documentBase: document.baseURI, source, blocksBase, enginesBase, version: opts.version },
    fetchJson
  )

  // THE APP'S OWN SESSION, read before the first receipt is fetched.
  //
  // The session server refuses a receipt without it when the app declares
  // sign-in, so this is not decoration: without the token the very first page
  // load 401s. Kept in a mutable binding because signing in must re-render the
  // route that was refused, not ask the visitor to reload.
  //
  // The order — the error a failed round trip left in the address bar, then
  // this tab's stored session, then the gateway's cookie — lives in
  // `boot-session.ts`. It runs before the router exists, so `?auth_error=` is
  // gone before anything reads the query string.
  const appId = project.id ?? project.title ?? 'app'
  // The app's words (envelope §2): every word the runner draws is read
  // here, and one the app does not set is drawn as nothing.
  const say = runnerMessages(project.messages, project.locale)
  const dataCache = sessionDataCache(sessionStorage, appId)
  // THE VISITOR'S CONSENT and the scripts that wait for it (envelope §2.2):
  // handed to every block as `context.consent` / `setConsent`; nothing is
  // loaded before the first page is drawn (`consent.start()` below).
  const consent = createConsent({
    appId,
    scripts: project.scripts,
    storage: (() => {
      try {
        return window.localStorage
      } catch {
        return undefined
      }
    })(),
    win: window,
    doc: document,
  })
  // THE VISITOR'S COLOUR SCHEME (appearance §4.1): handed to every block as
  // `context.colorScheme` / `setColorScheme`, kept in storage by the runner
  // alone and set as `data-pw-theme` on the document element.
  const colorScheme = createColorScheme({
    appId,
    storage: (() => {
      try {
        return window.localStorage
      } catch {
        return undefined
      }
    })(),
    root: document.documentElement,
  })
  const boot = await bootSession({ project, auth, storage: sessionStorage, appId })
  let appSession: AppSession | null = boot.session
  // A visitor who will see a page gets the renderer started now, so it is
  // evaluated while the page's receipt is on its way rather than after it. A
  // visitor the gate holds does not (renderer.ts).
  // THE APP'S OWN SIGN-IN SCREEN (`app.signIn`), when it ships one: drawn
  // like a page wherever the visitor has to, or asks to, sign in, and the
  // runner's dialog is never drawn. Without it the runner's dialog stands in.
  const ownSignIn =
    project.signInSurfaceId && receiptFilesOf(project)[project.signInSurfaceId] ? project.signInSurfaceId : undefined
  // The gate holds a visitor out of the pages, but an app with its own
  // sign-in screen draws that screen with the renderer.
  if (ownSignIn || !isGated(project, null, Boolean(appSession))) void loadRenderer(rendererUrl).catch(() => undefined)
  const initialError = boot.authError ? authErrorMessage(say, boot.authError) : undefined
  /**
   * WHY THE LAST SIGN-IN DID NOT SUCCEED, as the page reads it
   * (`__auth.error`): the code a provider round trip came back with, or the
   * password door's (`refused`, `exists`, …). Cleared by a sign-in or a
   * sign-out. The runner's own dialog shows its sentence beside it.
   */
  let authError: string | null = authErrorCode(boot.authError)

  /**
   * This app's own API base, read back out of the door it was published with
   * (see api-base.ts) — the same way for a password door and a provider door,
   * so a session from either reaches the app's records.
   */
  const ownApiBase = ownApiBaseOf(auth)

  /**
   * AN `entity` SOURCE WITH NO `connector` IS THE APP'S OWN RECORDS of its
   * `entityType` (data-protocol §2.2). With a base in hand it is served from
   * `<base>/records/<T>` as a `rest` source carrying `authProviderRef: <base>`
   * — the same rewrite `pwf dev` applies (see own-records.ts). Without one it
   * is left alone: no facade is built for it and it draws its `fallback`.
   * A connection serves a source only when the source names it.
   */
  const withOwnRecords = <R extends { capabilities?: unknown }>(receipt: R): R =>
    ownApiBase ? ownRecordsReceipt(receipt, ownApiBase) : receipt

  const pages = project.surfaceOrder
  const entry = project.entrySurfaceId
  const receiptFiles = receiptFilesOf(project)
  if (project.title) document.title = project.title

  // The shell declares its own base with `<base href>` — that is what the
  // publish path injects when it serves the app at `/` on a subdomain or under
  // a host's sub-path. Read the ELEMENT, not
  // `document.baseURI`: baseURI reports the document URL when no `<base>` is
  // present, which on a deep link to an unknown page is exactly the wrong
  // answer (it would make the unknown path look like the app's base).
  const declaredBase = document.querySelector('base')?.getAttribute('href') ?? undefined
  const router = createRouter(resolveRouterMode(opts.router ?? 'hash'), pages, entry, {
    basePath: declaredBase,
  })

  const mountSelector = opts.mount ?? '#root'
  const found = document.querySelector(mountSelector)
  if (!found) throw new Error(`[pwapp] mount container not found: ${mountSelector}`)
  const container: Element = found

  // Auth bridge — only when the envelope declares PKCE auth. Any other (or
  // malformed) provider degrades to anon rendering, like the demo did.
  let bridge: AuthBridge | null = null

  // WHO THE PLATFORM SESSION BELONGS TO, asked once.
  //
  // The account control shows a name. Login, register and the provider
  // exchange answer with the principal, so this is normally a no-op; a session
  // stored without one is completed from `sessionUrl` and written back — the
  // stored session is the cache.
  const hydrateProfile = async (session: AppSession): Promise<AppSession> => {
    const full = await withProfile(session, auth?.sessionUrl)
    if (full !== session && appSession?.token === session.token) {
      appSession = full
      writeAppSession(sessionStorage, appId, full)
    }
    return full
  }
  if (appSession) await hydrateProfile(appSession)

  // The shell chrome (gate, fallback pill) lives outside the surface root
  // that carries the theme, so it is handed the same resolved variables.
  // `let`: the preview bridge may swap the project theme in place (it goes
  // through `projectAppearanceRef` again, like this first read).
  let appearanceRef = projectAppearanceRef(appearance)
  const themeVars = shellThemeVars(appearanceRef)
  // ...and its dark mode, so a dark OS does not get a white gate on a dark app.
  if (typeof document !== 'undefined') {
    applyShellDarkMode(shellDarkThemeVars(appearanceRef), document, shellModePolicy(appearanceRef))
  }

  if (auth) {
    if (auth.provider === 'oauth2-pkce' && auth.issuer && auth.clientId) {
      // Redirect URI = the app base: ONE registered SPA redirect URI per app
      // (the path router gives every page its own pathname — per-page URIs
      // would each need their own registration at the issuer). returnTo in the
      // pending record brings the user back to the page they logged in from.
      bridge = createAuthBridge(auth, { redirectUri: location.origin + router.base, messages: say })
      await bridge.init() // redirect callback / silent restore BEFORE first route
    } else {
      const note = authDeclarationNote(auth)
      if (note) console.warn(note)
    }
  }

  // The shell refuses to render an app whose visitor has not signed in.
  //
  // Mounted right after the bridge settles its redirect callback and silent
  // restore, so a visitor returning from the issuer is already authenticated
  // and never sees the wall. The gate removes itself on the session it is
  // subscribed to; the API enforces the same rule again on every read, which
  // is what makes this honesty rather than security theatre.
  //
  // Mounted through a function because a sign-out has to put the wall back:
  // the gate keeps its own "signed in" flag, so after the platform session is
  // cleared the old gate is unsubscribed and a fresh one is drawn.
  // Signing in has to re-fetch the route that was refused. Without this the
  // wall comes down onto an empty page and the visitor reloads to fix it.
  const onSignedIn = (session: AppSession): void => {
    appSession = session
    authError = null
    signInMode = null
    writeAppSession(sessionStorage, appId, session)
    pill?.refresh()
    void route()
    void hydrateProfile(session).then((full) => {
      if (full !== session) void route()
    })
  }
  // Leaving the page is the runner's business, not the gate's — the gate
  // draws the button and reports the click. The gateway brings the visitor
  // back to the page they left from — hash included, since under the hash
  // router the hash IS the page.
  const startProvider = (method: string): void =>
    startSocialSignIn(auth, method, location.pathname + location.search + location.hash)
  const mountGate = (): (() => void) =>
    mountSignInGate(container, project, bridge, {
      auth,
      messages: say,
      onSignedIn,
      onProviderSignIn: startProvider,
      themeVars,
      // A refused arrival is shown, not swallowed.
      ...(initialError ? { initialError } : {}),
    })
  // The runner's wall only for an app that draws no sign-in screen of its own.
  let unmountGate = ownSignIn ? (): void => {} : mountGate()
  // The same dialog, opened by the app's own account control. Mounted on the
  // body so a route re-render (which replaces the container) cannot drop it.
  let closeOnDemandGate: (() => void) | null = null
  const showDialog = (message?: string, mode: SignInMode = 'login'): void => {
    closeOnDemandGate?.()
    closeOnDemandGate = mountSignInGate(document.body, project, bridge, {
      auth,
      messages: say,
      onSignedIn,
      onProviderSignIn: startProvider,
      themeVars,
      onDemand: true,
      initialMode: mode,
      ...(message ? { initialError: message } : {}),
      onDismiss: () => {
        closeOnDemandGate = null
      },
    })
  }
  /**
   * The sign-in screen the page asked for, while it is up — `null` when the
   * route's own page is drawn. Only for an app with its own screen; a route
   * change takes it down (the visitor went elsewhere), a sign-in too.
   */
  let signInMode: SignInMode | null = null
  const openSignIn = (mode: SignInMode): void => {
    if (!ownSignIn) {
      showDialog(undefined, mode)
      return
    }
    signInMode = mode
    void route()
  }
  // An app that does not require sign-in has no wall to carry a refused
  // arrival (Cancel on the platform screen, a provider error). Show where to
  // sign in instead — the app's screen, reading `__auth.error`, or the dialog
  // with the sentence — so the visitor learns why they are still signed out
  // and can try again or leave.
  if (initialError && !appSession && !isGated(project, bridge, false)) {
    if (ownSignIn) signInMode = 'login'
    else showDialog(initialError)
  }
  let pill: ReturnType<typeof mountSessionPill> | null = null

  // A connection's connector instance survives route changes per login session
  // (an engine's own caches — e.g. a site-id lookup — are the point); cleared
  // on logout/login.
  const connectorCache = new Map<string, EntityConnector>()

  // The surface CONNECTIONS CONTEXT for connector/provider
  // engine panels (chat-panel etc. — the engine-bridge path). One registry per
  // app session; its token resolver reads the LIVE token from the auth bridge
  // on every request, so login/rotation is transparent and the registry never
  // needs rebuilding. Built only with a PKCE bridge AND shipped engines —
  // otherwise null → those panels degrade honestly (the block's own sample /
  // the dataSource EntityFacade path). Coexists with `entityFacade`.
  let connectionsValue: SurfaceConnectionsValue | null = null
  // Kept outside the block: a token change reconfigures the registry from these
  // bindings, which also drops the declared engines mirrored into it below.
  let engineBindings: ConnectorConnectionBinding[] = []
  // Built when the first page is drawn, not at boot: the registry is the
  // runtime's, and the runtime arrives with the renderer.
  let enginesReady: Promise<void> | null = null
  const engineConnections = (): Promise<void> => (enginesReady ??= buildEngineConnections())
  async function buildEngineConnections(): Promise<void> {
    if (!bridge || !engineManifest || engineManifest.length === 0) return
    const { createConnectorEngineRegistry } = await import('@pwfabric/runtime')
    const authBridge = bridge
    const registry = createConnectorEngineRegistry({
      getAccessToken: async () => (await authBridge.getAccessToken()) ?? null,
    })
    const connByName = new Map((connections?.connections ?? []).map((c) => [c.name, c]))
    const bindings: ConnectorConnectionBinding[] = engineManifest
      // A DECLARED engine has no module and no hash. Mapping it here produced
      // a request for a file named "undefined".
      // Declarations are served by the facade, from the connection they were
      // just carried onto; the registry only ever owned the bundled form.
      .filter((e) => typeof e.moduleUrl === 'string' && e.moduleUrl.length > 0)
      .map((e) => {
      const cfg = connByName.get(e.connection)?.config
      return {
        connection: e.connection,
        descriptor: {
          id: e.atomId,
          kind: e.kind,
          // Already absolute: made so against the app's folder when the
          // manifest was read (load-envelope.ts).
          bundleUrl: e.moduleUrl!,
          integrity: e.integrity ?? '',
          // A provider facet's factory in its vendor's shared module.
          ...(e.export !== undefined ? { export: e.export } : {}),
        },
        ...(cfg ? { config: cfg } : {}),
      }
    })
    engineBindings = bindings
    registry.configure(bindings)
    const surfaceConnections: SurfaceConnection[] = (connections?.connections ?? []).map((c) => ({
      name: c.name,
      ...(c.connector ? { connector: c.connector } : {}),
      ...(c.config ? { config: c.config } : {}),
    }))
    connectionsValue = { connections: surfaceConnections, engines: registry }
  }

  // Whether the app has any way in, decided once: `auth.json` and the bridge
  // do not change after boot. Without one the declared account slot stays
  // empty (see applyAccountControl) and sign-in actions are ignored.
  const door = hasDoor({ project, auth, bridge })

  // ONE sign-out for every control that offers it (the shell's account slot,
  // the fallback pill): both doors, every cache, the wall back, a fresh render.
  const account = createAccountController({
    project,
    auth,
    bridge,
    getAppSession: () => appSession,
    clearAppSession: () => {
      appSession = null
      authError = null
      clearAppSession(sessionStorage, appId)
    },
    clearCaches: () => {
      dataCache.clear()
      connectorCache.clear()
    },
    regate: () => {
      closeOnDemandGate?.()
      closeOnDemandGate = null
      unmountGate()
      // A required app must not keep the previous visitor's page in the DOM
      // behind the wall.
      if (isGated(project, bridge, false)) container.replaceChildren()
      unmountGate = ownSignIn ? (): void => {} : mountGate()
      pill?.refresh()
    },
    rerender: () => void route(),
    openSignIn,
    startProvider,
    onSignedIn,
    onFailed: (code) => {
      authError = code
      void refreshAuth()
    },
    messages: say,
  })

  /** The ways in, for `__auth.methods` — decided once, like `door`. */
  const methods = authMethodsOf({ project, auth, bridge })
  /** What the page reads as `__auth` right now, and where its `auth:*` actions go. */
  const authHost = (): {
    state: ReturnType<typeof authStateOf>
    onAction: (action: Parameters<typeof account.perform>[0], input: { values?: Readonly<Record<string, unknown>> }) => void
  } => ({
    state: authStateOf({ appSession, bridgeSession: bridge?.session, methods, registration: auth?.registration, error: authError }),
    onAction: (action, input) => account.perform(action, input.values),
  })

  /** The page on screen, kept so an identity change that is not a sign-in can reach it in place. */
  let current: { seq: number; surface: unknown; options: Record<string, unknown>; handle: unknown; layout?: boolean } | null = null
  /**
   * THE PAGE READS A NEW `__auth` WITHOUT BEING DRAWN AGAIN. A refused
   * password leaves the visitor on the same form with what they typed; a
   * fresh render would empty it. A sign-in or sign-out still re-routes —
   * other records, other receipts.
   */
  async function refreshAuth(): Promise<void> {
    const page = current
    if (!page || page.seq !== routeSeq) return
    const handle = (await page.handle) as { update?: (o: Record<string, unknown>) => void } | null | undefined
    if (page !== current || typeof handle?.update !== 'function') return
    page.options = { ...page.options, identity: authHost() }
    handle.update({ ...page.options, surface: page.surface })
  }

  // THE PREVIEW BRIDGE — off unless the host asked for it (see
  // preview-bridge.ts). A published app's shell never passes the option, so
  // for every published app this is null and no listener exists.
  let preview: PreviewSession | null = null

  // Stale-route guard: a slow receipt fetch must not clobber a newer route.
  let routeSeq = 0
  /** The page and address seed now on screen — a query-only change that seeds the same state is not a re-render. */
  let shown: { key: string; seed: string } | null = null

  /**
   * A page's blocks as the visitor sees them: internal hrefs in the active
   * router's form, the navbar's links, the footer band, the account control.
   * One pipeline for a fetched receipt and for a surface the preview bridge pushed.
   */
  function pageBlocks(raw: SurfaceReceipt['blocks'], pageKey: string): SurfaceReceipt['blocks'] {
    return pageBlocksOf(raw, pageKey, pageContext())
  }

  /**
   * What a page is assembled from beside its receipt (first-frame.ts). EITHER
   * DOOR — not the bridge session only, so a visitor who came in through the
   * host's password door reaches the navbar too.
   */
  function pageContext(user = accountUserFrom({ appSession, bridgeSession: bridge?.session })): Parameters<typeof pageBlocksOf>[2] {
    return { entry, toHref: router.toHref, navigation, door, user, messages: say }
  }

  /**
   * THE BUILD'S FIRST FRAME OF THIS PAGE, when the shell holds one
   * (pwapp-format §2.5): `#pw-root` naming the page. Taken once — by the
   * first page drawn — at whatever width the window is: the frame is drawn at
   * the phone breakpoint and its stylesheet (`#pw-static-layout`) lays it out
   * for a wider one until the update after hydration does. Whether the
   * address lets the build's frame stand is the shell's first-paint script's
   * to decide — it knows which query keys change a page's first frame, and
   * leaves no frame in the root otherwise. The hydrating render reads no
   * address either way; the address's seed arrives in the update after it.
   */
  let staticTaken = false
  function staticRootFor(key: string): HTMLElement | null {
    if (staticTaken) return null
    staticTaken = true
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement) || root.id !== 'pw-root' || root.getAttribute(STATIC_PAGE_ATTR) !== key) return null
    if (container.childElementCount !== 1) return null
    return root
  }

  /** The first frame's stylesheet, once the page no longer needs it (see {@link STATIC_LAYOUT_ID}). */
  function dropStaticLayout(): void {
    document.getElementById(STATIC_LAYOUT_ID)?.remove()
  }

  /** The receipt a page was fetched from, for the not-found page and every route. */
  async function fetchReceipt(file: string): Promise<SurfaceReceipt> {
    // EITHER DOOR'S CREDENTIAL, because the gateway gates receipts behind
    // whichever door the app declared. A platform session is presented as
    // itself; an issuer's visitor presents the token minted for THIS app
    // (see AuthBridge.getDoorToken) — never the data token, whose audience
    // is the data provider and which the door rightly refuses.
    return withOwnRecords(
      await fetchJson<SurfaceReceipt>(
        withVersion(`${source}/${file}`, opts.version),
        doorHeaders({ appSession: appSession?.token, doorToken: await bridge?.getDoorToken() })
      )
    )
  }

  /**
   * THE APP'S LAYOUT (receipt §4), fetched once per load like a receipt —
   * with the visitor's credential — when `project.json` names one. One that
   * cannot be had is asked for again by the next page; until then pages are
   * drawn without it.
   */
  let layoutLoad: Promise<SurfaceReceipt | null> | undefined
  let layoutNow: SurfaceReceipt | null = null
  function appLayout(): Promise<SurfaceReceipt | null> {
    const file = project.layoutReceiptFile
    if (!file) return Promise.resolve(null)
    layoutLoad ??= fetchReceipt(file).then(
      (layout) => (layoutNow = layout),
      (err: unknown) => {
        console.warn('[pwapp] the app layout could not be fetched; this page is drawn without it', err)
        layoutLoad = undefined
        return null
      }
    )
    return layoutLoad
  }

  /** The pages drawn inside the layout: on to another one, the layout's blocks stay mounted. */
  const inLayout = new WeakSet<SurfaceReceipt>()

  /** Page `key`'s receipt, assembled into the layout (envelope §4 step 2): what every later step reads. */
  async function fetchPage(file: string, key: string, notFoundPage: boolean): Promise<SurfaceReceipt> {
    const [receipt, layout] = await Promise.all([fetchReceipt(file), appLayout()])
    return assembledPage(layout, receipt, key, notFoundPage)
  }

  function assembledPage(layout: SurfaceReceipt | null, receipt: SurfaceReceipt, key: string, notFoundPage: boolean): SurfaceReceipt {
    const { receipt: assembled, problems } = assemblePage(layout, receipt, { key, entry, notFoundPage, blocks: blockManifest })
    for (const p of problems) console.warn(`[pwapp] page "${key}": ${p.message}`)
    if (layout && receipt.layout !== false) inLayout.add(assembled)
    return assembled
  }

  /**
   * The mount of the page on screen, when the next page can be drawn into it
   * — both drawn inside the layout, and the mount still the one in the
   * document — so only what the page puts in the slot changes (receipt §4).
   */
  async function keptLayoutMount(): Promise<{ update(o: Record<string, unknown>): void } | null> {
    const page = current
    if (!page?.layout) return null
    const handle = (await page.handle) as { update?: (o: Record<string, unknown>) => void; container?: unknown } | null | undefined
    if (page !== current || typeof handle?.update !== 'function') return null
    const root = container.firstElementChild
    if (container.childElementCount !== 1 || !(root instanceof HTMLElement) || root.id !== 'pw-root') return null
    if (handle.container !== undefined && handle.container !== root) return null
    return handle as { update(o: Record<string, unknown>): void }
  }

  async function route(change?: RouteChange): Promise<void> {
    const gated = isGated(project, bridge, Boolean(appSession))
    // THE APP'S SIGN-IN SCREEN, at the address the visitor is on: in front of
    // every page while an app that requires sign-in has no visitor, and while
    // the page's own ask (`auth:signIn` with nothing to send) is up.
    if (ownSignIn && (gated || (signInMode !== null && !appSession && !bridge?.session))) {
      await showSignIn(++routeSeq)
      return
    }
    // Nothing to fetch behind the wall. The session server would refuse
    // the receipt anyway; asking for it would print a 401 under a gate the
    // visitor can already see, and teach nobody anything.
    if (gated) return
    const seq = ++routeSeq
    const key = router.current()

    // The location names no page this app has. Say so — do NOT substitute the
    // entry surface, which is what made every broken link look like a working
    // home page.
    if (key === null) {
      await showNotFound(seq)
      return
    }

    const file = receiptFiles[key]
    if (!file) throw new Error(`[pwapp] no receipt file for page "${key}"`)
    const receipt = await fetchPage(file, key, false)
    if (seq !== routeSeq) return

    /**
     * THE ADDRESS SEEDS PAGE STATE. `/product?id=12`
     * → `state.id = "12"`, merged into the receipt's persistence
     * `initialState` before render — the one seed path the renderer has.
     * Only keys the page reads are seeded; see queryStateSeed for what never is.
     *
     * A change that only touched the query re-renders ONLY if it changed
     * that seed. `?utm_source=x` on the same page is not a new page.
     */
    const params = new URLSearchParams(router.query())
    const seedSig = JSON.stringify(queryStateSeed(receipt, params))
    if (change?.queryOnly && shown !== null && shown.key === key && shown.seed === seedSig) {
      router.applyScroll()
      return
    }
    shown = { key, seed: seedSig }
    await renderPage(seq, key, receipt, params, false)
  }

  /**
   * THE NOT-FOUND PAGE, AT THE ADDRESS THAT NAMED NOTHING. The app's own
   * (`project.notFoundSurfaceId`) is drawn like any page — inside its shell,
   * with its navigation — so a reader who followed a wrong link is still in
   * the app. Only without one, or when it cannot be fetched, the runner's own
   * page is drawn.
   */
  async function showNotFound(seq: number): Promise<void> {
    shown = null
    const own = project.notFoundSurfaceId
    const file = own ? receiptFiles[own] : undefined
    if (own && file) {
      try {
        const receipt = await fetchPage(file, own, true)
        if (seq !== routeSeq) return
        await renderPage(seq, own, receipt, new URLSearchParams(router.query()), true)
        return
      } catch (err) {
        console.warn(`[pwapp] the not-found page "${own}" could not be drawn; showing the runner's own`, err)
        if (seq !== routeSeq) return
      }
    }
    showRunnerNotFound()
  }

  /**
   * The app's sign-in screen, drawn like the not-found page: inside the
   * shell, at the address that asked. If it cannot be drawn, the runner's
   * own dialog stands in — a visitor must always have a way in.
   */
  async function showSignIn(seq: number): Promise<void> {
    shown = null
    const key = ownSignIn as string
    try {
      const receipt = await fetchPage(receiptFiles[key] as string, key, false)
      if (seq !== routeSeq) return
      await renderPage(seq, key, receipt, new URLSearchParams(router.query()), true)
    } catch (err) {
      console.warn(`[pwapp] the sign-in screen "${key}" could not be drawn; showing the runner's own`, err)
      if (seq !== routeSeq) return
      if (isGated(project, bridge, Boolean(appSession))) {
        unmountGate()
        unmountGate = mountGate()
      } else showDialog(initialError)
    }
  }

  function showRunnerNotFound(): void {
    shown = null
    preview?.cleared()
    // The runner's own page wears the app's theme.
    document.documentElement.removeAttribute(PAGE_ATTR)
    renderNotFound({
      container,
      appTitle: project.title,
      entry,
      toHref: router.toHref,
      messages: say,
    })
    if (project.title) document.title = project.title
    applyDescription(document, undefined, project.description)
    if (router.mode === 'path') applyCanonical(document, undefined)
  }

  /**
   * The page's address seam (runtime render/address.ts), bound to the render
   * it was made for: a page that has been replaced writes nothing.
   */
  function pageAddress(seq: number, key: string, receipt: SurfaceReceipt, notFoundPage: boolean): SurfaceAddress {
    return {
      query: () => router.query(),
      writeQuery(values, how) {
        if (seq !== routeSeq) return
        const query = new URLSearchParams(router.query())
        for (const [k, v] of Object.entries(values)) {
          if (v === null) query.delete(k)
          else query.set(k, v)
        }
        router.writeQuery(query.toString(), how)
        // What the page shows now IS this address: a later move away from it
        // is a change, and a move to it is not.
        if (shown !== null && shown.key === key) shown = { key, seed: JSON.stringify(queryStateSeed(receipt, query)) }
      },
      notFound() {
        if (seq !== routeSeq) return
        // The not-found page's own record missing has nowhere further to go.
        if (notFoundPage) {
          ++routeSeq
          showRunnerNotFound()
          return
        }
        void showNotFound(++routeSeq)
      },
    }
  }

  /** Draws a fetched receipt as the page `key`. */
  async function renderPage(
    seq: number,
    key: string,
    receipt: SurfaceReceipt,
    params: URLSearchParams,
    notFoundPage: boolean
  ): Promise<void> {
    // The page's block modules start downloading now, beside the renderer.
    warmBlockModules(receipt.blocks, blockManifest)
    // The renderer, the first time a page is drawn (renderer.ts) — never for
    // a visitor the gate holds — and the engine registry, which is its.
    const fabric = await loadRenderer(rendererUrl)
    await engineConnections()
    if (seq !== routeSeq) return
    const address = pageAddress(seq, key, receipt, notFoundPage)
    const session = bridge?.session

    // A PER-RECORD TITLE (`{{dish.0.name}}`) is known only once its record
    // has loaded: until then the tab shows the app's title, and the renderer
    // reports the resolved page title through `onTitle` (receipt §1).
    const titleTemplate = typeof receipt.title === 'string' ? receipt.title : undefined
    const titleIsExpression = titleTemplate?.includes('{{') === true
    // The app's template and the page's say-so (receipt §1.1).
    const titleOptions = { template: project.titleTemplate, own: receipt.titleTemplate === false }
    const title = composeTitle(project.title, titleIsExpression ? undefined : titleTemplate, titleOptions)
    if (title) document.title = title
    // The description the same way: a template is never shown, the app's
    // stands in until the renderer reports it resolved (`onDescription`).
    const descriptionTemplate = typeof receipt.description === 'string' ? receipt.description : undefined
    applyDescription(document, descriptionTemplate, project.description)
    // The page's own address on the app's public origin, under path routing:
    // the not-found page has none. Under hash routing every page is the one
    // document the build wrote, and keeps its canonical address.
    if (router.mode === 'path') applyCanonical(document, notFoundPage ? undefined : canonicalOf(project.origin, router.toHref(key)))

    // Token-backed entity facade (only with a live session and declared
    // entity bindings) — otherwise omitted so embed's offline stubs apply.
    /**
     * A CONNECTION THAT NEEDS NO IDENTITY MUST NOT WAIT FOR ONE.
     *
     * Not only `bridge && session` — a PKCE bridge AND a live sign-in. That is
     * right for Microsoft Graph, which cannot answer without a delegated token,
     * but wrong for a public API, and a public API is what a plain REST
     * connection usually is: that app has no door, so it has no bridge, and
     * would have no data path at all.
     *
     * `auth.type === 'none'` is the engine's own declaration, not an inference.
     */
    const openData = needsNoIdentity(engineManifest)
    const entityFacade =
      (bridge && session) || openData
        ? await buildEntityFacade(
            extractEntityTypes(receipt),
            // The declaration the assembler put in the engine manifest, carried
            // onto the connection the facade actually reads. Both documents are
            // in hand exactly here and nowhere else.
            withDeclaredEngines(connections, engineManifest),
            async () => (bridge ? ((await bridge.getAccessToken()) ?? null) : null),
            connectorCache,
            // The registry, so a BUNDLED engine is served by the thing that
            // loaded it. Without this the facade can only serve declarations.
            connectionsValue?.engines ?? null
          )
        : undefined
    // What the facade just built for the DECLARED engines, the registry must
    // know too — the renderer asks the registry, not the facade, and answers
    // a source's fallback for any connection the registry calls unregistered.
    if (entityFacade) mirrorDeclaredEngines(connectionsValue?.engines, connectorCache)

    // EVERY BLOCK MODULE THE PAGE NAMES, AT ONCE, while the previous page is
    // still on screen. Drawn before they are in, a page arrived in one wave
    // per nesting level and shifted under the visitor at each (embed
    // load-blocks.ts); drawn after, it is one commit.
    // The page as this visitor sees it (first-frame.ts): its blocks, the
    // address's seed, the links in its capabilities' config. capabilities
    // MUST travel: DataBound derives its dataSources from them.
    const surface = pageSurfaceOf(receipt, key, params, pageContext())
    // The first frame's shared rules, put back while the modules load (only
    // the first page drawn can have a frame to hydrate).
    const sharedFilled = staticTaken
      ? Promise.resolve(true)
      : fillSharedStyles(container, document, (href) => fetch(href).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))))
    await fabric.loadBlocks(surface.blocks, blockManifest)
    const frameWhole = await sharedFilled
    if (seq !== routeSeq) return
    // The page the document shows: a page with a theme of its own has its
    // ground under `:root[data-pw-page]` in the theme stylesheet (the shell's
    // page-hints script set it before the first paint).
    document.documentElement.setAttribute(PAGE_ATTR, key)

    // The build's first frame of this page, when the shell holds it: hydrated,
    // not drawn again.
    // A frame whose shared rules could not be had is not the build's markup:
    // drawn anew rather than hydrated.
    const taken = staticRootFor(key)
    const staticRoot = frameWhole ? taken : null
    // From one page in the layout to another: the same mount, so the layout's
    // blocks stay mounted and only the slot's content changes.
    const kept = !staticRoot && inLayout.has(receipt) ? await keptLayoutMount() : null
    if (seq !== routeSeq) return
    if (!staticRoot && !kept) {
      dropStaticLayout()
      container.replaceChildren()
      const mount = document.createElement('div')
      mount.id = 'pw-root'
      container.appendChild(mount)
    }
    const renderOptions: Record<string, unknown> = {
      mode: 'fat',
      blocks: blockManifest,
      // Which page this is: another page in a kept mount starts its own state afresh.
      pageKey: key,
      // The appearance, the loading strategy (paint first, fill in after),
      // the link writer, the app's locale and words: the options the first
      // frame is drawn with, the same in the build (first-frame.ts).
      ...firstFrameOptions({ project, appearanceRef, receipt, entry, toHref: router.toHref }),
      // And a page the visitor has already seen shows yesterday's rows
      // while today's load, so going back and forth costs nothing visible.
      dataCache,
      consent,
      colorScheme,
      // A `navigate` action is followed as a link to its address would be
      // (router.follow): `location.assign('#rsvp')` replaced the hash route.
      onNavigateAction: (url: string) => router.follow(url),
      onTitle: (resolved: string | undefined) => {
        if (seq !== routeSeq) return
        const next = composeTitle(project.title, resolved, titleOptions)
        if (next) document.title = next
      },
      onDescription: (resolved: string | undefined) => {
        if (seq !== routeSeq) return
        applyDescription(document, resolved ?? descriptionTemplate, project.description)
      },
      // The page's address: its `urlState` and a split shell's selection live
      // in the route's query, and a record source that finds nothing reports
      // here (runtime render/address.ts).
      address,
      ...(entityFacade ? { entityFacade } : {}),
      // WHO IS SIGNED IN (`{{__auth.*}}`, `{{me.*}}`) and where every
      // `auth:*` action a block fires goes — the shell's account control, a
      // chip, a button, a form (see account-controller.ts).
      identity: authHost(),
      /**
       * WHO THE DATA REQUEST IS FROM.
       *
       * The gate lifting is only half of signing in. Every source that reads
       * the app's own records is a plain `fetch` to the host's record API
       * — and that door refuses an anonymous caller the moment the app
       * declares sign-in: login returns 200, the wall comes down, and the
       * very next request would come back `401 SIGN_IN_REQUIRED`.
       *
       * The runtime resolves a source's `authProviderRef` into an
       * `Authorization: Bearer` header, and the host API accepts a bearer
       * token; this answers that ref.
       *
       * READ AT REQUEST TIME, not captured. `appSession` is reassigned when
       * the visitor signs in or out, so a closure over the CURRENT value
       * would freeze whichever state the app happened to render in — the
       * first fetch after a sign-in would still be anonymous.
       */
      dataServiceConfig: {
        /**
         * MATCHED ON THE ADDRESS, NOT ON A SHARED NAME.
         *
         * The ref a source carries IS this app's own API base — the same
         * string the endpoint was built from. Both ends therefore derive the
         * name from something the package already ships, instead of agreeing
         * on a constant that would have to travel through a runtime shim.
         * (Contracts values do not reach a pwapp: the vendored shim is a
         * passthrough for a host global that a published app has no host to
         * set.)
         *
         * MATCHING MATTERS. Answering every ref with the visitor's token
         * would hand it to a connector's third-party endpoint — a credential
         * leak, not a convenience. A ref that is not our door gets nothing.
         *
         * EITHER TOPOLOGY, because both are "the visitor's credential for
         * this app": our own door yields an app session, an external issuer
         * yields a bridge token, and the API accepts a bearer of either.
         */
        getAccessToken: async (ref?: string): Promise<string | null> => {
          if (!isOwnApiRef(ref, ownApiBase)) return null
          if (appSession?.token) return appSession.token
          return (await bridge?.getAccessToken()) ?? null
        },
      },
      // Connector/provider engine registry + connections for
      // the engine-bridge panels. embed's fat render threads it to
      // DataBoundSurfaceRenderer, which exposes it via SurfaceConnectionsContext.
      ...(connectionsValue ? { connections: connectionsValue } : {}),
    }
    let rendered: unknown
    if (staticRoot) rendered = hydrateFirstFrame(staticRoot, receipt, key, surface, renderOptions)
    else if (kept) {
      kept.update({ ...renderOptions, surface })
      rendered = kept
    } else rendered = fabric.render('#pw-root', { surface }, renderOptions)
    current = { seq, surface, options: renderOptions, handle: rendered, layout: inLayout.has(receipt) }
    if (preview && !notFoundPage) {
      // Kept, not discarded: the bridge re-renders through this handle.
      const surfaceId = receiptSurfaceId(receipt)
      preview.rendered({
        seq,
        key,
        ...(surfaceId ? { surfaceId } : {}),
        surface,
        options: renderOptions,
        handle: rendered,
      })
    } else {
      if (notFoundPage) preview?.cleared()
      void rendered
    }
    // Where the address says — the top for a plain page, the anchored element
    // when it names one. An unconditional scrollTo(0,0) here is what undid an
    // in-page link even once the router resolved it.
    router.applyScroll()
  }

  /**
   * HYDRATES the build's first frame of the page, then brings it to this
   * visit. The hydrating render gets exactly the build's inputs — nobody
   * signed in, nothing read from the address, no cached rows, the phone
   * breakpoint, the first frame's locale — so React adopts the HTML node for
   * node; the visit's own (the signed-in visitor, the data cache, the
   * visitor's formats) arrive right after, as an update of the same tree,
   * the way a sign-in would.
   *
   * ADDRESS NOT PASSED TO THE HYDRATING RENDER. The first frame was built
   * without any address seed (`?id=` or other query keys), so the hydrating
   * render must start with the same state the build used: nothing read from
   * the address. If the live `address` were passed here, the runtime's
   * `useNotFoundReport` would see the record source as idle (empty key,
   * state not yet seeded) and immediately call `address.notFound()` —
   * replacing the page before the address seed has a chance to arrive. The
   * address (and the URL-seeded `initialState`) arrive in the update that
   * fires inside `onHydrated`, after React has adopted the painted tree.
   */
  function hydrateFirstFrame(
    root: HTMLElement,
    receipt: SurfaceReceipt,
    key: string,
    surface: ReturnType<typeof pageSurfaceOf>,
    options: Record<string, unknown>
  ): Promise<unknown> {
    const fabric = window.PWFabric as NonNullable<Window['PWFabric']>
    const firstDoor = firstFrameDoorOf(project)
    const first = pageSurfaceOf(receipt, key, new URLSearchParams(), { ...pageContext(FIRST_FRAME_USER), door: firstDoor.door })
    const identity = authHost()
    // Strip `address` and `dataCache` from the hydrating render: the former would
    // trigger a premature not-found report (see block comment above); the latter
    // is the session cache, which carries yesterday's rows — the hydrating render
    // must match the HTML the build wrote.
    const { dataCache: _cache, address: _addr, ...rest } = options
    const handle: Promise<unknown> = Promise.resolve(
      fabric.render(root, { surface: first }, {
        ...rest,
        identity: { ...identity, state: firstFrameAuthState(firstDoor) },
        viewport: STATIC_VIEWPORT,
        locale: firstFrameLocale(project),
        hydrate: true,
        // After the hydrating commit (an update before it would make React
        // drop the HTML and draw the page again).
        onHydrated: () => {
          void handle.then((h) => {
            const update = (h as { update?: (o: Record<string, unknown>) => void } | null)?.update
            if (current?.handle !== handle || typeof update !== 'function') return
            update({ ...options, surface })
            // The update draws the page at the window's own breakpoint; once
            // it is on screen the first frame's stylesheet says nothing the
            // inline styles do not (two frames: the commit, then its paint).
            requestAnimationFrame(() => requestAnimationFrame(dropStaticLayout))
          })
        },
      })
    )
    return handle
  }

  if (opts.previewBridge) {
    preview = startPreviewSession(opts.previewBridge, {
      win: window as unknown as Parameters<typeof startPreviewSession>[1]['win'],
      crypto: globalThis.crypto,
      isCurrent: (page: PreviewPage) => page.seq === routeSeq && router.current() === page.key,
      // The same pipeline a fetched receipt goes through, and the same query
      // seeding — the pushed page behaves like the built one would.
      prepare: (pushed: PreviewSurface) => {
        const key = router.current() ?? entry
        const receipt = assembledPage(layoutNow, withOwnRecords(pushed as unknown as SurfaceReceipt), key, false)
        const seeded = seedStateFromQuery(receipt, new URLSearchParams(router.query()))
        return {
          blocks: pageBlocks(receipt.blocks, key),
          ...(pushed.appearance !== undefined ? { appearance: pushed.appearance } : {}),
          capabilities: rewriteHrefs(seeded.capabilities ?? [], entry, router.toHref),
        }
      },
      // THE TOKEN PATH. The pushed theme is resolved exactly as
      // `pwpack/appearance.json` is on load, and handed to the renderer as the
      // appearance ref — never written into the page as CSS.
      applyTheme: (theme: Record<string, unknown>) => {
        const ref = projectAppearanceRef(theme)
        if (!ref) return undefined
        appearanceRef = ref
        if (typeof document !== 'undefined') {
          applyShellDarkMode(shellDarkThemeVars(ref), document, shellModePolicy(ref))
        }
        return ref
      },
      remount: (surface, renderOptions) => {
        const fabric = window.PWFabric
        if (!fabric) return undefined
        return fabric.render('#pw-root', { surface }, renderOptions)
      },
    })
  }

  router.start((change) => {
    // The visitor went elsewhere: the sign-in screen they asked for is not
    // where they are going.
    if (!change?.queryOnly) signInMode = null
    void route(change)
  })

  if (bridge) {
    bridge.subscribe(() => {
      connectorCache.clear() // token identity changed — drop per-session caches
      // The mirrored declared engines closed over the old token; rebuild the
      // registry from the bundled bindings and let the next route mirror anew.
      if (connectionsValue?.engines) connectionsValue.engines.configure(engineBindings)
      void route() // re-run the current route under the new login state
    })
  }

  // The pill is the FALLBACK for apps whose shell declares no account slot.
  // It serves both doors, so it is mounted whether or not a bridge exists;
  // without a bridge and without a session it hides itself. An app with no
  // way in at all gets no pill (and asks for none of its words). Sign-out goes
  // through the one controller every account control shares.
  pill = mountSessionPill({
    bridge,
    door,
    auth,
    getAppSession: () => appSession,
    onSignedOut: () => void account.signOut(),
    onSignOut: () => account.signOut(),
    // The pill is the fallback for an app that draws no way in of its own: no
    // account control in its shell and no sign-in screen.
    accountSlot: Boolean(navigation?.account) || Boolean(ownSignIn),
    themeVars,
    messages: say,
  })

  await route()
  consent.start()
}
