/**
 * The zod schemas of `layout-schema.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'

export const responsiveNumberSchema = z
  .object({
    xs: z.number().int().min(0).optional(),
    sm: z.number().int().min(0).optional(),
    md: z.number().int().min(0).optional(),
    lg: z.number().int().min(0).optional(),
    xl: z.number().int().min(0).optional(),
    '2xl': z.number().int().min(0).optional(),
  })
  .strict()

export const responsiveBooleanSchema = z
  .object({
    xs: z.boolean().optional(),
    sm: z.boolean().optional(),
    md: z.boolean().optional(),
    lg: z.boolean().optional(),
    xl: z.boolean().optional(),
    '2xl': z.boolean().optional(),
  })
  .strict()

export const breakpointNameSchema = z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl'])

/**
 * Width scope — the ONLY vocabulary the engine knows on this axis.
 *
 * `container` fits the measured container, `viewport` leaves it. There is no
 * third value: in-between words such as "half", "wide" or "full" belong to a
 * shell's vocabulary and live in the pack. The engine applies only the
 * difference between "fit the container" and "leave the container".
 */
export const widthScopeSchema = z.enum(['container', 'viewport'])

export const responsiveWidthScopeSchema = z
  .object({
    xs: widthScopeSchema.optional(),
    sm: widthScopeSchema.optional(),
    md: widthScopeSchema.optional(),
    lg: widthScopeSchema.optional(),
    xl: widthScopeSchema.optional(),
    '2xl': widthScopeSchema.optional(),
  })
  .strict()

export const blockLayoutSchema = z.object({
  span: responsiveNumberSchema,
  offset: responsiveNumberSchema.optional(),
  order: responsiveNumberSchema.optional(),
  hidden: responsiveBooleanSchema.optional(),
  hideOn: z.array(breakpointNameSchema).optional(),
  showOn: z.array(breakpointNameSchema).optional(),
  widthScope: responsiveWidthScopeSchema.optional(),
})

// ============================================================
// CASCADE RESOLUTION
