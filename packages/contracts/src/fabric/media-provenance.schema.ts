/**
 * The zod schemas of `media-provenance.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { MEDIA_PROVENANCE_SOURCES, MediaProvenance, MediaProvenanceValidation } from './media-provenance.js'

export const MediaProvenanceEntrySchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
  source: z.enum(MEDIA_PROVENANCE_SOURCES),
  model: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  license: z.string().min(1).optional(),
  origin: z.string().url().optional(),
})

export const MediaProvenanceSchema = z
  .object({
    formatVersion: z
      .string()
      .regex(/^\d+\.\d+$/, 'formatVersion must be MAJOR.MINOR, e.g. "1.0"')
      .optional(),
    items: z.array(MediaProvenanceEntrySchema),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    doc.items.forEach((item, i) => {
      if (seen.has(item.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'path'],
          message: `media provenance lists "${item.path}" more than once`,
        })
      }
      seen.add(item.path)
    })
  })

// ============================================================
// HELPERS

/** Parse a `media/provenance.json` document. Throws a `ZodError` when it is not valid. */
export function parseMediaProvenance(input: unknown): MediaProvenance {
  // Cast: zod's optional output is `T | undefined`; the contract type is
  // `T`-or-absent (exactOptionalPropertyTypes). Same shape.
  return MediaProvenanceSchema.parse(input) as MediaProvenance
}

/** Validate a `media/provenance.json` document without throwing. Issues read `path: message`. */
export function safeParseMediaProvenance(input: unknown): MediaProvenanceValidation {
  const parsed = MediaProvenanceSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data as MediaProvenance }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)),
  }
}
