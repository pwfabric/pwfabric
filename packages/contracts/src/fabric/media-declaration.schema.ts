/**
 * The zod schemas of `media-declaration.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { MEDIA_DECLARATION_KINDS, MediaDeclaration, MediaDeclarationValidation } from './media-declaration.js'

/** `media/<name>`: one safe segment directly below `media/`, not the provenance record. */
function isMediaFilePath(value: string): boolean {
  if (!value.startsWith('media/')) return false
  const name = value.slice('media/'.length)
  return name.length > 0 && !/[\\/\0]/.test(name) && name !== '.' && name !== '..' && name !== 'provenance.json'
}

export const MediaDeclarationSlotSchema = z.object({
  surfaceKey: z.string().min(1),
  blockId: z.string().min(1),
  prop: z.string().min(1),
})

export const MediaDeclarationSchema = z.object({
  kind: z.enum(MEDIA_DECLARATION_KINDS),
  purpose: z.string().optional(),
  origin: z.string().min(1).optional(),
  slots: z.array(MediaDeclarationSlotSchema).optional(),
  status: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  decorative: z.boolean().optional(),
  file: z
    .string()
    .refine(isMediaFilePath, 'file must be media/<name>: one file directly in media/, not provenance.json, no "." or ".." name, no backslash')
    .optional(),
})

// ============================================================
// HELPERS

/** Parse a media declaration. Throws a `ZodError` when it is not valid. */
export function parseMediaDeclaration(input: unknown): MediaDeclaration {
  // Cast: zod's optional output is `T | undefined`; the contract type is
  // `T`-or-absent (exactOptionalPropertyTypes). Same shape.
  return MediaDeclarationSchema.parse(input) as MediaDeclaration
}

/** Validate a media declaration without throwing. Issues read `path: message`. */
export function safeParseMediaDeclaration(input: unknown): MediaDeclarationValidation {
  const parsed = MediaDeclarationSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data as MediaDeclaration }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)),
  }
}
