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

// ============================================================

export type MediaDeclarationValidation =
  { readonly ok: true; readonly value: MediaDeclaration } | { readonly ok: false; readonly issues: readonly string[] }

