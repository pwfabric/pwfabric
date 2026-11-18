/**
 * The zod schemas of `surface-appearance.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'

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
    theme: z.record(z.string(), z.unknown()).optional(),
    darkTheme: z.record(z.string(), z.unknown()).optional(),
    styleVariables: z.record(z.string(), z.string()).optional(),
    keyframes: z.record(z.string(), z.string()).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
    mode: AppearanceModeSchema.optional(),
    brand: AppearanceBrandSchema.optional(),
  })
  .passthrough()

// ============================================================
// SURFACE APPEARANCE REFERENCE (surface.appearance)

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
