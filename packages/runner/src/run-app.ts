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

import {
  createConnectorEngineRegistry,
  type EntityConnector,
  type ConnectorConnectionBinding,
  type SurfaceConnection,
  type SurfaceConnectionsValue,
} from '@pwfabric/runtime'
import type { RunAppOptions, SurfaceReceipt } from './types.js'
import { assembleFooter, assembleNav, composeTitle, doorHeaders, fetchJson, queryStateSeed, receiptFilesOf, rewriteHrefs, seedStateFromQuery, withVersion } from './helpers.js'
import { createRouter, resolveRouterMode, type RouteChange } from './router.js'
import { createAuthBridge, type AuthBridge } from './auth.js'
import { accountUserFrom, applyAccountControl } from './apply-auth.js'
import { accountActionOf, createAccountController, hasDoor } from './account-controller.js'
import { applyShellDarkMode, shellDarkThemeVars, shellModePolicy, shellThemeVars } from './shell-theme.js'
import { THEME_PRESETS } from './theme-presets.js'
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
import { authErrorMessage } from './copy.js'
import { renderNotFound } from './not-found.js'
import { receiptSurfaceId, startPreviewSession, type PreviewPage, type PreviewSession } from './preview-session.js'
import type { PreviewSurface } from './preview-bridge.js'

/**
 * `pwpack/appearance.json` holds the project's appearance CONFIG
 * (`{ theme, styleVariables, darkTheme, … }`) — that is what
 * `assembleWebApp` writes from `appearanceConfigSnapshot`. But embed's
 * `appearance` option is a surface appearance REF (`{ config }`), and it
 * OVERRIDES `surface.appearance` outright.
 *
 * Handing the config straight through would replace each surface's correct
 * ref with an object the resolver cannot read: it looks for
 * `appearance.config.theme`, finds nothing, and falls back to the default
 * baseline, so every exported app would paint indigo whatever theme it
 * shipped.
 *
 * Wrap it. Anything already ref-shaped passes through untouched, as does the
 * legacy `{ use: 'default' }` fallback.
 */
export function projectAppearanceRef(raw: unknown): { config: Record<string, unknown> } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if ('config' in o) return o as { config: Record<string, unknown> }
  // A THEME NAME. An app may carry only `{ "use": "theme-zinc" }` —
  // sometimes with brand colours pressed on top (`theme.colors`), nothing
  // else. The preset
  // is the base and anything the document states wins over it; an unknown name
  // (or `default`) leaves the document as it was.
  const preset = presetFor(o['use'])
  if (preset) {
    const { use: _use, ...rest } = o
    const own = (rest['theme'] ?? undefined) as Record<string, unknown> | undefined
    return { config: { ...rest, theme: mergeThemeGroups(preset, own) } }
  }
  // A bare config: it carries token groups, not a ref.
  if ('theme' in o || 'styleVariables' in o || 'darkTheme' in o || 'keyframes' in o) {
    return { config: o }
  }
  return undefined
}

/** The foundation preset a theme name points at: `theme-zinc`, or bare `zinc`. */
function presetFor(use: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof use !== 'string' || !use.trim()) return undefined
  const name = use.trim()
  return THEME_PRESETS[name] ?? THEME_PRESETS[`theme-${name.replace(/^(appearance|theme)-/, '')}`]
}

/** Per-group merge, `over` winning — the same shape the appearance cascade merges. */
function mergeThemeGroups(
  base: Readonly<Record<string, unknown>>,
  over: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) out[k] = v && typeof v === 'object' ? { ...v } : v
  for (const [k, v] of Object.entries(over ?? {})) {
    const prev = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object'
        ? { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) }
        : v
  }
  return out
}

export async function runApp(opts: RunAppOptions = {}): Promise<void> {
  const source = String(opts.source ?? './pwpack').replace(/\/+$/, '')
  const blocksBase = String(opts.blocks ?? './blocks/').replace(/\/+$/, '')

  const enginesBase = String(opts.engines ?? './engines').replace(/\/+$/, '')
  // `auth.json` is asked for only when `project.json` declares an identity
  // (see load-envelope.ts); every other file in parallel, as before.
  const { project, navigation, appearance, auth, connections, blockManifest, engineManifest } = await loadEnvelope(
    { source, blocksBase, enginesBase, version: opts.version },
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
  const locale = opts.locale ?? 'en'
  const dataCache = sessionDataCache(sessionStorage, appId)
  const boot = await bootSession({ project, auth, storage: sessionStorage, appId })
  let appSession: AppSession | null = boot.session
  const initialError = boot.authError ? authErrorMessage(locale, boot.authError) : undefined

  /**
   * This app's own API base, read back out of the door it was published with.
   *
   * `auth.json` writes the host's door as plain addresses — `loginUrl` is
   * `<base>/login` — precisely so a published app carries no host name in its
   * code. The same property makes the base recoverable here, which is
   * what lets a data source say "my credential comes from this address"
   * without either end hardcoding one.
   */
  const ownApiBase = ((): string | null => {
    const login = (auth as { loginUrl?: string } | null)?.loginUrl
    if (typeof login !== 'string' || !login.endsWith('/login')) return null
    return login.slice(0, -'/login'.length)
  })()

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
      bridge = createAuthBridge(auth, { redirectUri: location.origin + router.base, locale })
      await bridge.init() // redirect callback / silent restore BEFORE first route
    } else {
      console.info(`[pwapp] auth declared (${auth.provider}) — unsupported provider, falling back to anonymous`)
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
      locale,
      onSignedIn,
      onProviderSignIn: startProvider,
      themeVars,
      // A refused arrival is shown, not swallowed.
      ...(initialError ? { initialError } : {}),
    })
  let unmountGate = mountGate()
  // The same dialog, opened by the app's own account control. Mounted on the
  // body so a route re-render (which replaces the container) cannot drop it.
  let closeOnDemandGate: (() => void) | null = null
  const openGate = (): void => {
    closeOnDemandGate?.()
    closeOnDemandGate = mountSignInGate(document.body, project, bridge, {
      auth,
      locale,
      onSignedIn,
      onProviderSignIn: startProvider,
      themeVars,
      onDemand: true,
      onDismiss: () => {
        closeOnDemandGate = null
      },
    })
  }
  let pill: ReturnType<typeof mountSessionPill> | null = null

  // graph-lists connector instance survives route changes per login session
  // (its site-id cache is the point); cleared on logout/login.
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
  if (bridge && engineManifest && engineManifest.length > 0) {
    const authBridge = bridge
    const registry = createConnectorEngineRegistry({
      getAccessToken: async () => (await authBridge.getAccessToken()) ?? null,
    })
    const connByName = new Map((connections?.connections ?? []).map((c) => [c.name, c]))
    const bindings: ConnectorConnectionBinding[] = engineManifest
      // A DECLARED engine has no module and no hash. Mapping it here produced
      // `new URL(undefined, baseURI)` — a request for a file named "undefined".
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
          // Engines ship export-relative; absolutize against the document so the
          // loader fetches them under any host root / sub-path (base law).
          bundleUrl: new URL(e.moduleUrl!, document.baseURI).href,
          integrity: e.integrity ?? '',
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
      unmountGate = mountGate()
      pill?.refresh()
    },
    rerender: () => void route(),
    openGate,
    startProvider,
  })

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
    let blocks = rewriteHrefs(raw, entry, router.toHref)
    blocks = assembleNav(blocks, navigation, entry, router.toHref)
    blocks = assembleFooter(blocks, navigation, pageKey, entry, router.toHref)
    // EITHER DOOR — not the bridge session only, so a visitor who came in
    // through the host's password door reaches the navbar too.
    const user = accountUserFrom({ appSession, bridgeSession: bridge?.session })
    // The declared slot is drawn only when the app has a door (`hasDoor`); an
    // app without one gets the greeting fallback, never a dead "Sign in".
    return applyAccountControl(blocks, {
      declaration: navigation?.account,
      door,
      user,
      entry,
      toHref: router.toHref,
      locale,
    })
  }

  async function route(change?: RouteChange): Promise<void> {
    // Nothing to fetch behind the wall. The session server would refuse
    // the receipt anyway; asking for it would print a 401 under a gate the
    // visitor can already see, and teach nobody anything.
    if (isGated(project, bridge, Boolean(appSession))) return
    const seq = ++routeSeq
    const key = router.current()

    // The location names no page this app has. Say so — do NOT substitute the
    // entry surface, which is what made every broken link look like a working
    // home page.
    if (key === null) {
      shown = null
      preview?.cleared()
      renderNotFound({
        container,
        appTitle: project.title,
        entry,
        toHref: router.toHref,
        locale,
      })
      if (project.title) document.title = project.title
      return
    }

    const file = receiptFiles[key]
    if (!file) throw new Error(`[pwapp] no receipt file for page "${key}"`)
    // EITHER DOOR'S CREDENTIAL, because the gateway gates receipts behind
    // whichever door the app declared. A platform session is presented as
    // itself; an issuer's visitor presents the token minted for THIS app
    // (see AuthBridge.getDoorToken) — never the data token, whose audience
    // is the data provider and which the door rightly refuses.
    const receipt = await fetchJson<SurfaceReceipt>(
      withVersion(`${source}/${file}`, opts.version),
      doorHeaders({ appSession: appSession?.token, doorToken: await bridge?.getDoorToken() })
    )
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
    const seededCapabilities = seedStateFromQuery(receipt, params).capabilities

    const blocks = pageBlocks(receipt.blocks, key)
    const session = bridge?.session

    const title = composeTitle(project.title, receipt.title)
    if (title) document.title = title

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

    container.replaceChildren()
    const mount = document.createElement('div')
    mount.id = 'pw-root'
    container.appendChild(mount)

    const fabric = window.PWFabric
    if (!fabric) throw new Error('[pwapp] window.PWFabric not found — embed.js is not loaded')
    // capabilities MUST travel: DataBound derives its dataSources from
    // surface.capabilities — omitting them leaves every `{{source}}`
    // expression unresolved and data blocks stuck in their error state.
    const surface = { blocks, appearance: receipt.appearance, capabilities: seededCapabilities ?? [] }
    const renderOptions: Record<string, unknown> = {
      mode: 'fat',
      blocks: blockManifest,
      appearance: appearanceRef ?? receipt.appearance ?? {},
      // PAINT FIRST, FILL IN AFTER. The gate held every page behind
      // "Loading data..." for the whole round trip to the records API —
      // seconds on every page change. The chrome, headings
      // and static cards are in the receipt already; only the lists wait.
      loadingStrategy: 'immediate',
      // And a page the visitor has already seen shows yesterday's rows
      // while today's load, so going back and forth costs nothing visible.
      dataCache,
      ...(entityFacade ? { entityFacade } : {}),
      // The account control's two actions. The renderer forwards every block
      // event here; the runtime's own dispatcher ignores these types.
      onEvent: (event: unknown) => {
        const action = accountActionOf(event)
        if (action === 'signOut') void account.signOut()
        else if (action === 'signIn') account.signIn()
      },
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
          if (!ref || !ownApiBase || ref.replace(/[/]+$/, '') !== ownApiBase) return null
          if (appSession?.token) return appSession.token
          return (await bridge?.getAccessToken()) ?? null
        },
      },
      // Connector/provider engine registry + connections for
      // the engine-bridge panels. embed's fat render threads it to
      // DataBoundSurfaceRenderer, which exposes it via SurfaceConnectionsContext.
      ...(connectionsValue ? { connections: connectionsValue } : {}),
    }
    const rendered = fabric.render('#pw-root', { surface }, renderOptions)
    if (preview) {
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
      void rendered
    }
    // Where the address says — the top for a plain page, the anchored element
    // when it names one. An unconditional scrollTo(0,0) here is what undid an
    // in-page link even once the router resolved it.
    router.applyScroll()
  }

  if (opts.previewBridge) {
    preview = startPreviewSession(opts.previewBridge, {
      win: window as unknown as Parameters<typeof startPreviewSession>[1]['win'],
      crypto: globalThis.crypto,
      isCurrent: (page: PreviewPage) => page.seq === routeSeq && router.current() === page.key,
      // The same pipeline a fetched receipt goes through, and the same query
      // seeding — the pushed page behaves like the built one would.
      prepare: (pushed: PreviewSurface) => {
        const receipt = pushed as unknown as SurfaceReceipt
        const seeded = seedStateFromQuery(receipt, new URLSearchParams(router.query()))
        return {
          blocks: pageBlocks(receipt.blocks, router.current() ?? entry),
          ...(pushed.appearance !== undefined ? { appearance: pushed.appearance } : {}),
          capabilities: seeded.capabilities ?? [],
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
  // without a bridge and without a session it hides itself. Sign-out goes
  // through the one controller every account control shares.
  pill = mountSessionPill({
    bridge,
    auth,
    getAppSession: () => appSession,
    onSignedOut: () => void account.signOut(),
    onSignOut: () => account.signOut(),
    accountSlot: Boolean(navigation?.account),
    themeVars,
    locale,
  })

  await route()
}
