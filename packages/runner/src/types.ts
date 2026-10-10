/**
 * pwpack source-envelope types — the RUNTIME-read contract (the export
 * contract).
 *
 * Everything here is data the runner FETCHES from the pwpack folder/URL —
 * never compiled in. All paths are relative / base-independent; platform
 * publish paths (`/p/…`) never appear in the envelope.
 *
 * @module @pwfabric/runner/types
 */

import type { DynamicBlockDescriptor, SocialMethod } from '@pwfabric/contracts'
import type { PreviewBridgeOptions } from './preview-bridge.js'

// ============================================================
// PROJECT ENVELOPE
// ============================================================

/**
 * `project.json` — ideal form carries `surfaceReceiptFiles`; legacy envelopes
 * omit it (the runner falls back to `surfaces/<key>.receipt.json`, see
 * `receiptFilesOf`).
 */
export interface PwappProject {
  readonly schemaVersion?: string | number
  readonly id?: string
  readonly title?: string
  readonly entrySurfaceId: string
  readonly surfaceOrder: readonly string[]
  readonly surfaceReceiptFiles?: Readonly<Record<string, string>>
  /**
   * WHO THE VISITOR IS — frozen at export.
   *
   * `authRequired` lived in the plan, was drawn on the canvas card and never
   * left the platform: nothing in a published app could read it, so an app
   * that "requires sign-in" shipped with no sign-in and served every page to
   * anyone with the URL. This is the half that travels.
   */
  readonly identity?: {
    readonly required: boolean
    readonly topology?: 'app' | 'external'
    readonly methods?: readonly string[]
  }
}

/** Which shell block carries the visitor's account control. */
export type AccountPlacement = 'navbar' | 'bottom-bar' | 'app-rail'

/** One entry of an account menu. `href` is an app route or an absolute URL. */
export interface PwappAccountLink {
  readonly label: string
  readonly href: string
}

/**
 * THE ACCOUNT BELONGS TO THE APP'S SHELL.
 *
 * Declared in `navigation.json`, next to the links it sits beside. The runner
 * injects an `account` prop (see `AccountProp`) into every block of type
 * `placement` on the rendered page; the block draws sign-in, the signed-in
 * visitor and sign-out in the app's own appearance, and dispatches
 * `{ type: 'auth:signIn' }` / `{ type: 'auth:signOut' }` back.
 *
 * Absent, the runner falls back to the floating session pill.
 */
export interface PwappAccountDeclaration {
  readonly placement: AccountPlacement
  /** App route of the profile page, e.g. `/profile/`. */
  readonly profileHref?: string
  readonly links?: readonly PwappAccountLink[]
}

/** One link of a footer column — hrefs root-relative to the app, like the navbar's. */
export interface PwappFooterLink {
  readonly label: string
  readonly href: string
  /**
   * Where the link opens. Unset, an absolute `http(s):` or protocol-relative
   * `//` address opens in a new tab and everything else in the same one.
   */
  readonly target?: '_self' | '_blank'
}

/** `navigation.footer` — link columns the runner draws as the page's footer band. */
export interface PwappFooterDeclaration {
  readonly columns?: readonly {
    readonly heading?: string
    readonly links?: readonly PwappFooterLink[]
  }[]
  /** Page keys that carry no footer band. */
  readonly excludeSurfaces?: readonly string[]
}

/** `navigation.json` — assembly source for empty navbar links and the footer band. */
export interface PwappNavigation {
  readonly navbar?: {
    readonly links?: readonly unknown[]
  }
  readonly account?: PwappAccountDeclaration
  readonly footer?: PwappFooterDeclaration
}

/**
 * The prop the runner injects into the declared shell block. Hrefs are
 * already in the active router's form; labels in the app's content locale.
 */
export interface AccountProp {
  readonly state: 'signed-in' | 'signed-out'
  readonly name?: string
  readonly email?: string
  readonly avatarSrc?: string
  readonly profileHref?: string
  readonly links?: readonly PwappAccountLink[]
  readonly signInLabel?: string
  readonly signOutLabel?: string
  readonly profileLabel?: string
}

/**
 * `auth.json` — the app's identity binding (data layer; the runner is
 * mechanism).
 *
 * `tenantId` is gone. It named an Entra tenant, and the runner turned it into
 * `login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize` by string
 * concatenation — which meant one vendor was the only identity a published app
 * could ever have, and "let people sign in with GitHub" had no place to be
 * written down. What sits here now is an ISSUER: an address the app was told,
 * the same way a data source is an address the app was told. The runner does
 * not know whose it is, and the platform's own door arrives here as a URL like
 * anyone else's — which is what keeps a published app free of any dependency
 * on us beyond the endpoints it was handed.
 */
export interface PwappAuth {
  /** `oauth2-pkce` for an issuer flow, `password` for the platform door. */
  readonly provider: string
  /** The `iss` value tokens carry, and the OIDC discovery base. */
  readonly issuer: string
  readonly clientId: string
  readonly scopes: readonly string[]
  /**
   * Stated endpoints win over discovery. The exporter fills these in at
   * publish time so the login path costs no extra round trip; hand-written
   * `auth.json` may omit them and the runner discovers them once.
   */
  readonly authorizeUrl?: string
  readonly tokenUrl?: string
  /**
   * THE APP'S OWN API AT ITS ISSUER — its Application ID URI.
   *
   * An external-topology app signs its visitor in at the owner's issuer and
   * gets tokens for the DATA it reads (Graph, say). None of those is a
   * credential for the platform door: an ID token is for the client, and a
   * Graph token names Graph as its audience. The door wants a token minted
   * FOR THIS APP — `aud` = this app — which is what OAuth resource servers
   * accept and nothing else. So the owner exposes an API on the same
   * registration (`api://<clientId>` by default), pre-authorizes the client
   * for it, and declares it here; the runner then redeems the refresh token
   * for `<audience>/.default` when a receipt is fetched. Never on the
   * authorize request — Entra refuses `.default` beside resource scopes
   * there. Absent, the app cannot present itself to a gated door.
   */
  readonly audience?: string
  /**
   * Legacy server-callback path (e.g. '/auth/callback'). The runner does NOT
   * use it as redirect_uri (the shell itself is the redirect target so the
   * app works on any static host) — it is only honored for backward compat
   * when the current URL already equals it during a callback.
   */
  readonly redirectPath?: string
  /**
   * THE PLATFORM DOOR, as addresses.
   *
   * Present when the project signs people in HERE — email and password posted
   * to a URL, no redirect and no discovery document. The runner never knows a
   * platform hostname: it posts to whatever the export handed it, exactly as it
   * does with an external issuer's endpoints.
   */
  readonly loginUrl?: string
  readonly registerUrl?: string
  readonly logoutUrl?: string
  readonly sessionUrl?: string
  /**
   * THE SOCIAL BUTTONS OF THE APP DOOR — names only.
   *
   * The browser no longer spends a code, so it needs nothing about a provider
   * but which one to ask for: the gateway starts the flow at
   * `{startUrl}/{method}`, the API holds every client id, secret and token
   * address, and the session comes back as a cookie on the app's own origin.
   * A package therefore carries no OAuth registration at all.
   *
   * Filtered before it was written: a method the project did not declare, or
   * one the deployment cannot serve, is absent rather than present and broken.
   * Empty or absent, the door is password-only.
   */
  readonly providers?: readonly PwappProviderButton[]
  /**
   * THE GATEWAY'S SIGN-IN ADDRESSES, on the app's own origin.
   *
   * Defaults: `/_auth/start`, `/_auth/session`, `/_auth/logout`. Declared so
   * an app served under a sub-path can be told where its gateway listens.
   */
  readonly startUrl?: string
  readonly gatewaySessionUrl?: string
  readonly gatewayLogoutUrl?: string
}

/** One social sign-in button: `host` (an account on the platform hosting the app) or a provider. */
export interface PwappProviderButton {
  readonly method: 'host' | SocialMethod
}

/** One configured connection inside `connections.json`. */
export interface PwappConnection {
  readonly name: string
  readonly connector?: string
  readonly config?: Record<string, unknown>
}

/** `connections.json` — connector engine bindings for this tenant. */
export interface PwappConnections {
  readonly connections?: readonly PwappConnection[]
}

/** One entry of `engines/manifest.json` — a shipped connector/provider engine
 * bundle. `connection` is the name `connections.json` /
 *  `dataSources[].connector` references; `moduleUrl` is export-relative;
 *  `integrity` is the SHA-256 verified before evaluation. */
export interface PwappEngineDescriptor {
  readonly connection: string
  readonly atomId: string
  readonly kind: 'connector' | 'provider'
  /**
   * BUNDLED — export-relative module and the hash verified before evaluation.
   * Absent when the engine is declared.
   */
  readonly moduleUrl?: string
  readonly integrity?: string
  /**
   * DECLARED — the engine travels as DATA and no file is written.
   *
   * The assembler writes this form, so the reader's type must express it:
   * `moduleUrl`/`integrity` (bundled) and `engine` (declared) are
   * alternatives.
   */
  readonly engine?: unknown
}

/** `engines/manifest.json` — the export's shipped connector-engine list. */
export type PwappEngineManifest = readonly PwappEngineDescriptor[]

// ============================================================
// SURFACE RECEIPT
// ============================================================

/** A node in a receipt's block tree (free-form JSON, walked structurally). */
export interface SurfaceBlockNode {
  type?: string
  props?: Record<string, unknown>
  children?: SurfaceBlockNode[]
  [key: string]: unknown
}

/** `surfaces/<key>.receipt.json` — the per-page render input. */
export interface SurfaceReceipt {
  readonly title?: string
  readonly blocks: SurfaceBlockNode[]
  readonly appearance?: unknown
  readonly capabilities?: readonly {
    readonly capability?: string
    readonly config?: Record<string, unknown>
  }[]
  readonly [key: string]: unknown
}

// ============================================================
// BLOCK MANIFEST
// ============================================================

/** `blocks/manifest.json` — pinned block bundle descriptors (type → module). */
export type BlockManifest = readonly DynamicBlockDescriptor[]

// ============================================================
// RENDER ENGINE (provided by embed.js, NOT this package)
// ============================================================

/**
 * The page loads embed.js which defines `window.PWFabric.render`. The runner
 * only calls it — the render engine is never bundled here.
 */
export interface PWFabricGlobal {
  render(
    target: HTMLElement | string,
    source: { surface: { blocks: unknown; appearance?: unknown; capabilities?: unknown } },
    options: Record<string, unknown>
  ): Promise<unknown> | unknown
}

declare global {
  interface Window {
    PWFabric?: PWFabricGlobal
    /**
     * SPFx host seam: when the app runs inside a SharePoint web part the host
     * injects an AADTokenProvider bridge — tokens brokered by SharePoint, no
     * PKCE flow (ported from an earlier React AuthProvider.tsx).
     */
    __pwfabric_getToken?: (resource: string) => Promise<string | undefined>
  }
}

// ============================================================
// PUBLIC API OPTIONS
// ============================================================

export type RouterMode = 'hash' | 'path' | 'auto'

export interface RunAppOptions {
  /** pwpack folder path OR absolute URL. Default `'./pwpack'`. */
  readonly source?: string
  /** Folder containing `manifest.json`. Default `'./blocks/'`. */
  readonly blocks?: string
  /** Folder containing the connector-engine `manifest.json`.
   *  Default `'./engines'`. */
  readonly engines?: string
  /**
   * `'hash'` (default — works on every static host), `'path'` (host with SPA
   * fallback), or `'auto'` = `'path'` iff `history.pushState` works AND the
   * server declared SPA fallback via `<meta name="pw-router" content="path">`.
   */
  readonly router?: RouterMode
  /** Mount container selector. Default `'#root'`. */
  readonly mount?: string
  /**
   * Content locale of the delivered app (world-preferences.locale) — selects
   * locale-dependent runtime fallbacks (e.g. the greeting fallback name in
   * apply-auth). Default `'en'`.
   */
  readonly locale?: 'en' | 'tr'
  /**
   * PREVIEW ONLY. Lets the framing page push the page it holds in memory and
   * the project theme into this app, re-rendered without a rebuild (see
   * `preview-bridge.ts` and spec/hosting-security.md §5). Absent — the default,
   * and always the case for a published app — no message listener is added.
   */
  readonly previewBridge?: PreviewBridgeOptions
}
