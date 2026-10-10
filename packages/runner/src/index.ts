/**
 * @pwfabric/runner — public surface.
 *
 * `runApp` is the boot contract (`import { runApp } from './assets/runner.js'`
 * in the pwapp shell). The pure helpers are exported for unit tests and for
 * hosts that need the same envelope math (e.g. a host's own page runner).
 *
 * @module @pwfabric/runner
 */

export { runApp } from './run-app.js'

// Pure envelope helpers
export { pageKeyOf, rewriteHrefs, assembleNav, assembleFooter, FOOTER_BAND_ID, receiptFilesOf, composeTitle, fetchJson, doorHeaders } from './helpers.js'
export type { ToHref } from './helpers.js'

// Router
export { createRouter, resolveRouterMode } from './router.js'
export { renderNotFound } from './not-found.js'

// Preview bridge (off by default; see preview-bridge.ts)
export {
  PREVIEW_MESSAGE,
  MAX_PREVIEW_MESSAGE_BYTES,
  createPreviewBridge,
  normalizeAllowedOrigins,
} from './preview-bridge.js'
export type {
  PreviewBridgeOptions,
  PreviewBridge,
  PreviewSurface,
  PreviewSurfaceUpdate,
} from './preview-bridge.js'
export type { RouterHandle, RouterOptions } from './router.js'

// Auth (PKCE)
export {
  authScopeKey,
  pendingKeyFor,
  refreshTokenKeyFor,
  generateCodeVerifier,
  generateCodeChallenge,
  resolveEndpoints,
  discoveryUrlOf,
  clearDiscoveryCache,
  type OAuthEndpoints,
  buildAuthorizeUrl,
  savePendingPkce,
  takePendingPkce,
} from './pkce.js'
export type { KeyValueStorage, PkcePending } from './pkce.js'
export { createAuthBridge } from './auth.js'
export { sessionDataCache } from './data-cache.js'
export type { DataCache } from './data-cache.js'
export type { AuthBridge } from './auth.js'
export {
  applyAuthToSurface,
  applyAccountControl,
  applyAccountToSurface,
  applyGreeting,
  accountUserFrom,
  buildAccountProp,
} from './apply-auth.js'
export type { AccountUser } from './apply-auth.js'
export { accountActionOf, createAccountController, hasDoor } from './account-controller.js'
export type { AccountAction, AccountController, AccountControllerDeps } from './account-controller.js'
export {
  shellThemeVars,
  shellDarkThemeVars,
  applyThemeVars,
  applyShellDarkMode,
  shellModePolicy,
  ensureShellStyles,
} from './shell-theme.js'
export type { ShellModePolicy } from './shell-theme.js'
export { THEME_PRESETS } from './theme-presets.js'

// Entity facade
export { extractEntityTypes, buildEntityFacade } from './entity-facade.js'
export type { EntityBinding } from './entity-facade.js'

// Types
export type {
  PwappProject,
  PwappNavigation,
  PwappFooterDeclaration,
  PwappFooterLink,
  PwappAccountDeclaration,
  PwappAccountLink,
  AccountPlacement,
  AccountProp,
  PwappAuth,
  PwappConnection,
  PwappConnections,
  SurfaceBlockNode,
  SurfaceReceipt,
  BlockManifest,
  PWFabricGlobal,
  RouterMode,
  RunAppOptions,
  PwappProviderButton,
} from './types.js'

export { mountSignInGate, isGated } from './sign-in-gate.js'
export type { SignInGateOptions } from './sign-in-gate.js'
export {
  mountSessionPill,
  mountLoginButton,
  sessionLabel,
  type SessionPill,
  type SessionPillOptions,
} from './session-pill.js'
export {
  appSessionKey,
  readAppSession,
  writeAppSession,
  clearAppSession,
  signIn,
  signOut,
  withProfile,
  startSocialSignIn,
  readGatewaySession,
  readAuthError,
  DEFAULT_START_URL,
  DEFAULT_GATEWAY_SESSION_URL,
  DEFAULT_GATEWAY_LOGOUT_URL,
  type AppSession,
  type AppSessionPrincipal,
  type AppDoor,
} from './app-session.js'
export { bootSession } from './boot-session.js'
export type { BootSessionInput, BootSessionResult } from './boot-session.js'
export { RUNNER_COPY, AUTH_ERROR_CODES, copyFor, authErrorMessage } from './copy.js'
export type { RunnerLocale, RunnerCopy, AuthErrorCode, ProviderLabelKey } from './copy.js'
