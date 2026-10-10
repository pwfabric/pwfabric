/**
 * Surface Appearance
 *
 * `surface.appearance` carries the surface's own theme DATA — nothing more.
 *
 * Appearance is not an executable engine loaded from a pack bundle: the
 * `ui-appearance` atom kind is declared `bundled: false / payloadShape:
 * 'json-payload'`, and every surface is painted by the in-process cascade.
 *
 * A theme is data: either a
 * preset the platform ships, or an `ui-appearance` atom a pack publishes whose
 * payload IS the token set. Selecting one copies its tokens into
 * `appearance.config.theme`; nothing is resolved by reference at render time.
 *
 * @module @pwfabric/contracts/fabric/surface-appearance
 */

import { z } from 'zod'
import type { SurfaceTheme } from './surface-theme.js'

// ============================================================
// MODE POLICY AND BRAND ASSETS
// ============================================================

/**
 * Which colour modes an app wears.
 *
 * WHY: without a policy the runtime derives a dark variant for EVERY config
 * and applies it under `prefers-color-scheme: dark`, so an app meant to be
 * light switches to dark on a dark device. This is how an app says "this app
 * is light".
 *
 *   light   the app is light only — no dark variant is emitted
 *   dark    the app is dark only — the dark variant is the only palette
 *   system  follow the visitor's device (the default)
 */
export type AppearanceModePolicy = 'light' | 'dark' | 'system'

/**
 * The contrast level an app promises.
 *
 *   normal  WCAG AA: 4.5:1 for text, 3:1 for UI components (the default)
 *   high    WCAG AAA-level text: 7:1 for text, 4.5:1 for UI components
 */
export type AppearanceContrast = 'normal' | 'high'

export const APPEARANCE_MODE_POLICIES: readonly AppearanceModePolicy[] = ['light', 'dark', 'system']
export const APPEARANCE_CONTRASTS: readonly AppearanceContrast[] = ['normal', 'high']

/** `appearanceConfig.mode` — every field optional; see `resolveAppearanceMode`. */
export interface AppearanceMode {
  readonly policy?: AppearanceModePolicy
  readonly contrast?: AppearanceContrast
}

/**
 * The app's brand assets, as references (a media-library URL or path).
 *
 * Schema only: WHERE they render (the logo in the navbar, the favicon as the
 * app icon, never as a body block) is decided by the delivery and publish
 * paths, which read these names.
 */
export interface AppearanceBrand {
  readonly logo?: string
  readonly favicon?: string
}

/** A mode with every field filled: `{ policy: 'system', contrast: 'normal' }` when unset. */
export interface ResolvedAppearanceMode {
  readonly policy: AppearanceModePolicy
  readonly contrast: AppearanceContrast
}

/**
 * The mode a config asks for, with defaults filled and unknown values ignored.
 * Accepts anything, so a stored document with a stray value reads as the
 * default instead of throwing.
 */
export function resolveAppearanceMode(config: unknown): ResolvedAppearanceMode {
  const mode =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as { mode?: unknown }).mode
      : undefined
  const m = mode && typeof mode === 'object' && !Array.isArray(mode) ? (mode as Record<string, unknown>) : {}
  const policy = APPEARANCE_MODE_POLICIES.includes(m['policy'] as AppearanceModePolicy)
    ? (m['policy'] as AppearanceModePolicy)
    : 'system'
  const contrast = APPEARANCE_CONTRASTS.includes(m['contrast'] as AppearanceContrast)
    ? (m['contrast'] as AppearanceContrast)
    : 'normal'
  return { policy, contrast }
}

// ============================================================
// APPEARANCE CONFIG
// ============================================================

/**
 * The surface's appearance payload: the theme token set plus the escape hatches
 * that the structured token system deliberately does not cover.
 */
export interface AppearanceConfig {
  /** SurfaceTheme token set (colors / border / typography / spacing / shadows /
   * motion / layout / focus / zIndex). */
  readonly theme?: Partial<SurfaceTheme>
  /**
   * Dark theme variant tokens (partial SurfaceTheme). An editor BAKES this at write
   * time (`deriveDarkTheme` over the effective light theme) so the author can
   * see and edit the dark palette instead of it being invisible render-time
   * magic. When absent, the runtime derives one on the fly.
   *
   * The runtime emits scoped dark CSS that applies these tokens BOTH under the
   * OS preference (`@media (prefers-color-scheme:dark)`, unless force-light) AND
   * when the surface root is force-toggled via `[data-pw-theme="dark"]`. Only
   * the tokens set here override the light `theme`; everything else falls back
   * to the resolved light values.
   */
  readonly darkTheme?: Partial<SurfaceTheme>
  /** Custom CSS custom properties outside the structured token system */
  readonly styleVariables?: Readonly<Record<string, string>>
  /**
   * Surface-scoped custom `@keyframes` registry (name → keyframe body).
   *
   * The runtime ships a fixed set of `pw-*` keyframes (pulse/fade-in/marquee/
   * slide/scale/spin/bounce); `block.style.animation` could only reference
   * those. This lets a surface declare ARBITRARY named keyframes so a block can
   * drive custom motion offline. The runtime emits one `@keyframes <name>{<body>}`
   * per entry, prefixing each name with `pw-kf-` to avoid host-page collision —
   * so a block references it via `animation: pw-kf-<name> …`. Honours
   * `prefers-reduced-motion` (the surface base CSS neutralises animations).
   *
   * @example { wiggle: '0%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}100%{transform:rotate(-3deg)}' }
   */
  readonly keyframes?: Readonly<Record<string, string>>
  /** Free-form extensions (forward compatibility) */
  readonly extensions?: Readonly<Record<string, unknown>>
  /** Which colour modes the app wears and the contrast it promises. */
  readonly mode?: AppearanceMode
  /** Logo and favicon references (schema only). */
  readonly brand?: AppearanceBrand
}

export const AppearanceModeSchema = z
  .object({
    policy: z.enum(['light', 'dark', 'system']).optional(),
    contrast: z.enum(['normal', 'high']).optional(),
  })
  .strict()

export const AppearanceBrandSchema = z
  .object({
    logo: z.string().min(1).max(2048).optional(),
    favicon: z.string().min(1).max(2048).optional(),
  })
  .strict()

export const AppearanceConfigSchema = z
  .object({
    theme: z.record(z.unknown()).optional(),
    darkTheme: z.record(z.unknown()).optional(),
    styleVariables: z.record(z.string()).optional(),
    keyframes: z.record(z.string()).optional(),
    extensions: z.record(z.unknown()).optional(),
    mode: AppearanceModeSchema.optional(),
    brand: AppearanceBrandSchema.optional(),
  })
  .passthrough()

// ============================================================
// SURFACE APPEARANCE REFERENCE (surface.appearance)
// ============================================================

/**
 * What `surface.appearance` holds. Config only — there is no atom id to resolve.
 */
export interface SurfaceAppearanceRef {
  /** The surface's theme data */
  readonly config?: AppearanceConfig
}

/**
 * `.passthrough()` rather than `.strict()`: stored documents written before the
 * still carry the retired `use` key, and a strict schema would
 * fail them on read. The backend migration strips the key; once it has run
 * everywhere this can tighten back to `.strict()`.
 */
export const SurfaceAppearanceRefSchema = z
  .object({
    config: AppearanceConfigSchema.optional(),
  })
  .passthrough()
