/**
 * Media declarations — which image or file an app needs, and which page slots
 * its address goes into.
 *
 * One declaration per file, keyed by its file name: `app/media/<key>.json`.
 * A declaration carries no bytes. When the bytes travel in the pack, `file`
 * names them by their path from the pack root (`media/hero.webp`), the same
 * form as `media/provenance.json` `items[].path`, which records where they
 * came from.
 *
 * The same records appear in `app/plan.json` `media[]`; the two agree by
 * construction.
 *
 * @module @pwfabric/contracts/fabric/media-declaration
 */

import { z } from 'zod'

// ============================================================
// TYPES
// ============================================================

/** What a declaration asks for. */
export const MEDIA_DECLARATION_KINDS = ['image', 'file'] as const
export type MediaDeclarationKind = (typeof MEDIA_DECLARATION_KINDS)[number]

/**
 * Where the asset came from, as producers write it today. The vocabulary is
 * open: a reader accepts any non-empty string and treats an unknown one as
 * "not known to be a person's choice".
 *
 * - `provided` — shipped with a pack or supplied by the host.
 * - `placeholder` — a stand-in until a real asset exists.
 * - `generated` — produced by a model.
 * - `uploaded` — added by a person (bytes a brief supplied are this).
 * - `library` — picked from a media library.
 */
export const MEDIA_DECLARATION_ORIGINS = ['provided', 'placeholder', 'generated', 'uploaded', 'library'] as const
export type MediaDeclarationOrigin = (typeof MEDIA_DECLARATION_ORIGINS)[number]

/** One block prop on one page that receives the asset's address. */
export interface MediaDeclarationSlot {
  readonly surfaceKey: string
  readonly blockId: string
  readonly prop: string
}

/** The parsed `app/media/<key>.json`. */
export interface MediaDeclaration {
  readonly kind: MediaDeclarationKind
  /** What the asset is for, in words. */
  readonly purpose?: string
  /** Where the asset came from; see {@link MEDIA_DECLARATION_ORIGINS}. */
  readonly origin?: string
  /** Where the address lands. A host writes it into exactly these props. */
  readonly slots?: readonly MediaDeclarationSlot[]
  /** The need's state as the producer left it (`pending`, `ready`, …). */
  readonly status?: string
  /** The asset's address, once it has one. */
  readonly url?: string
  /** Ambience, not content. */
  readonly decorative?: boolean
  /**
   * The bytes in the pack, as a path from the pack root: `media/<name>`
   * (`media/hero.webp`), one file directly in `media/`. Same form as
   * `media/provenance.json` `items[].path`.
   */
  readonly file?: string
}

// ============================================================
// SCHEMAS
// ============================================================

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
// ============================================================

export type MediaDeclarationValidation =
  { readonly ok: true; readonly value: MediaDeclaration } | { readonly ok: false; readonly issues: readonly string[] }

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
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
  }
}
