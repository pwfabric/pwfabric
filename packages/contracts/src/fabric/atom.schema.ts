/**
 * The zod schemas of `atom.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { surfaceThemeSchema } from './surface-schema.schema.js'
import { ATOM_KINDS, BLOCK_ORIGIN_DIRECTIVES, BLOCK_ORIGIN_INVALID, BlockOriginDirective, BlockOrigins, BlockOriginsValidation, blockOriginProblem } from './atom.js'

export const AtomManifestKnowledgeSchema = z
  .object({
    purpose: z.string().min(1, 'knowledge.purpose is required'),
    useCases: z.array(z.string().min(1)).min(1, 'knowledge.useCases must have at least one entry'),
    composesWith: z.array(z.string().min(1)),
    antiPatterns: z
      .array(z.string().min(1))
      .min(1, 'knowledge.antiPatterns must have at least one entry'),
    /**
     * The build detail that must NOT ride on every composer call.
     *
     * The four fields above are what the prose generator reads, so every word
     * in them is spent on every compose. A generator that writes a component
     * tends to put the whole build specification into `purpose`; this is
     * where that spec goes instead:
     * it stays with the atom it describes, for a human or a repair agent
     * reading the manifest, and costs nothing per call because no prose
     * generator reads it.
     *
     * Optional, and the object stays `.strict()` — this authorises exactly one
     * named field, not an open bag. No length cap here either: `purpose` is
     * capped by the pack's own integrity gate, which is where a token-budget
     * rule can see what it is budgeting.
     */
    implementation: z.string().optional(),
  })
  .strict()

// ============================================================
// ATOM MANIFEST CONFIG (capability config-schema)

export const AtomManifestConfigFieldSchema = z
  .object({
    key: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'select', 'multi-select', 'url', 'email', 'json']),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    label: z.string().min(1),
    description: z.string().optional(),
    group: z.string().optional(),
    order: z.number().optional(),
    sensitive: z.boolean().optional(),
    options: z
      .array(
        z
          .object({
            value: z.string(),
            label: z.string(),
            description: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    constraints: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        pattern: z.string().optional(),
        patternMessage: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const AtomManifestConfigSchema = z
  .object({
    fields: z.array(AtomManifestConfigFieldSchema),
  })
  .strict()

// ============================================================
// CONNECTOR / PROVIDER SCOPE DECLARATION

export const AtomScopeDeclarationSchema = z
  .object({
    name: z.string().min(1),
    adminConsent: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()

// ============================================================
// ATOM FILE MANIFEST (per-atom manifest.json on disk)

const blockOriginSchema = z.string().superRefine((value, ctx) => {
  const problem = blockOriginProblem(value)
  if (problem) {
    ctx.addIssue({
      code: 'custom',
      params: { code: BLOCK_ORIGIN_INVALID },
      message: `${BLOCK_ORIGIN_INVALID}: "${value}" — ${problem}`,
    })
  }
})

export const BlockOriginsSchema = z
  .object(Object.fromEntries(BLOCK_ORIGIN_DIRECTIVES.map((d) => [d, z.array(blockOriginSchema).optional()])) as {
    [D in BlockOriginDirective]: z.ZodOptional<z.ZodArray<typeof blockOriginSchema>>
  })
  .strict()

/** Validate a block's `definition.origins` without throwing. Issues read `path: message`. */
export function safeParseBlockOrigins(input: unknown): BlockOriginsValidation {
  const parsed = BlockOriginsSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data as BlockOrigins }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)),
  }
}

const traitNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'trait names must be kebab-case')

export const AtomBlockDefinitionMetadataSchema = z
  .object({
    props: z.array(z.record(z.string(), z.unknown())),
    defaultProps: z.record(z.string(), z.unknown()),
    canHaveChildren: z.boolean(),
    allowedParents: z.array(z.string().min(1)).optional(),
    icon: z.string().optional(),
    traits: z.array(traitNameSchema).optional(),
    allowedChildTraits: z.array(traitNameSchema).optional(),
    origins: BlockOriginsSchema.optional(),
  })
  .strict()

/** Schema twin of {@link AtomFileManifest.forkedFrom}. Module-private: the field ships as a type, not as a new schema export. */
const atomForkOriginSchema = z
  .object({
    pack: z.string().min(1),
    version: z.string().min(1),
    atomId: z.string().min(1),
    hash: z.string().min(1),
  })
  .strict()

/**
 * A connector atom DECLARES its engine instead of shipping
 * one.
 *
 * Once `HttpEntityConnector` carries the transport, what is left of a Graph
 * engine is seven lines of fact. A class holding them would be transport the
 * base already owns plus two value transforms — and a signature to get wrong
 * (one options object where the runtime passes two positional arguments is
 * enough to request `lists/undefined`). A declaration has no signature to get
 * wrong.
 *
 * NOTHING EXECUTABLE MAY APPEAR HERE, and that is the whole discipline. There
 * is no function, no expression, no template language. `transforms[].use` is a
 * NAME resolved against a CLOSED registry in the runtime; an unknown name is a
 * validation error, never a silent pass. A declaration that could carry a
 * function would be a class again with extra steps.
 *
 * NO CREDENTIAL EITHER. `auth` states the KIND only. Which identity, and its
 * live token, come from the running app at call time — the
 * same rule that keeps credentials out of a published bundle keeps them out of
 * a manifest.
 */
export const engineDeclarationSchema = z
  .object({
    /** Origin + version prefix, e.g. `graph.microsoft.com/v1.0`. */
    host: z.string().min(1),
    /**
     * Optional pre-flight: call `path`, take `field` from the answer, bind it
     * into the path template as `as`. Graph cannot address a list until the
     * site id is resolved, and declaring that step is precisely what stops it
     * from becoming an argument for an asynchronous base.
     */
    resolve: z
      .object({ path: z.string().min(1), field: z.string().min(1), as: z.string().min(1) })
      .strict()
      .optional(),
    /** Path template — `{entityType}` plus any binding named by `resolve.as`. */
    path: z.string().min(1),
    /** Fixed query parameters the API requires (e.g. `expand=fields`). */
    params: z.record(z.string(), z.string()).optional(),
    auth: z.object({ type: z.enum(['bearer', 'api-key', 'basic', 'none']) }).strict(),
    read: z
      .object({
        /** Path to the array in the response body, e.g. `value`. */
        items: z.string().min(1),
        id: z.string().min(1),
        /** A nested bag whose keys are lifted to the row, e.g. `fields`. */
        flatten: z.string().min(1).optional(),
        /** Top-level keys to keep alongside the flattened bag. */
        lift: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    /** Write shape — e.g. Graph wants the row under `fields`. */
    write: z.object({ bodyWrap: z.string().min(1).optional() }).strict().optional(),
    /** Named value transforms, resolved against the runtime's closed registry. */
    transforms: z
      .array(z.object({ field: z.string().min(1), use: z.string().min(1) }).strict())
      .optional(),
  })
  .strict()

const connectorEntityFieldBase = {
  name: z.string().min(1),
  label: z.string().optional(),
  required: z.boolean().optional(),
}

export const ConnectorEntityFieldSchema = z.union([
  z.object({ ...connectorEntityFieldBase, type: z.enum(['text', 'number', 'boolean', 'date']) }).strict(),
  z
    .object({ ...connectorEntityFieldBase, type: z.literal('relation'), targetTypeId: z.string().min(1).optional() })
    .strict(),
])

export const ConnectorEntityDeclarationSchema = z
  .object({
    entityType: z.string().min(1),
    displayName: z.string().optional(),
    fields: z.array(ConnectorEntityFieldSchema),
  })
  .strict()

export const AtomFileManifestSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ATOM_KINDS),
    version: z.string().min(1),
    name: z.string().min(1),
    state: z.enum(['stable', 'beta', 'alpha', 'deprecated', 'experimental']),
    category: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    knowledge: AtomManifestKnowledgeSchema,
    definition: AtomBlockDefinitionMetadataSchema.optional(),
    config: AtomManifestConfigSchema.optional(),
    theme: surfaceThemeSchema.optional(),
    // a ui-appearance atom's own dark variant (appearance.md): the tokens it
    // sets override the derived dark palette.
    darkTheme: surfaceThemeSchema.optional(),
    // connector/provider payload. `connection` + `configSchema`
    // describe data already in production; `scopes` is the new declaration.
    connection: z.string().min(1).optional(),
    configSchema: AtomManifestConfigSchema.optional(),
    scopes: z.array(AtomScopeDeclarationSchema).optional(),
    // a connector atom may state its engine rather than
    // compile one. Absent, the atom behaves exactly as before.
    engine: engineDeclarationSchema.optional(),
    // the entities a connector serves and the fields of their rows.
    entities: z.array(ConnectorEntityDeclarationSchema).optional(),
    // Fork origin: absent = an original atom.
    forkedFrom: atomForkOriginSchema.optional(),
  })
  .strict()
