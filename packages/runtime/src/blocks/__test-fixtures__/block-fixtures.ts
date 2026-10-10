/**
 * Block Fixtures
 *
 * Canonical test fixture for registry-dependent suites — supplies the
 * `BlockRegistry` / `CompositionRuleEngine` / composer-prompt /
 * introspection tests with a populated set of `BlockDefinition` stubs.
 * Production code MUST NOT import from this module; production block
 * metadata flows through the install pipeline (`useInstalledAtoms`
 * browser-side, `installedBlocksOverride` server-side).
 *
 * The 45 stubs carry only the metadata the rule engine and composition
 * validators consult: `type`, `name`, `category`, `schema`,
 * `defaultProps`, `canHaveChildren`, optional `allowedChildren`/
 * `allowedParents`. Component implementations live exclusively in
 * `pwpack-source/<pack>/blocks/<cat>/<name>/component.tsx` and are
 * loaded at runtime via `BlockModuleLoader` from the published CDN
 * bundle. The stub `type` set + enum values mirror the historic
 * first-party catalog because composer-prompt + introspection tests
 * verify parity against that catalog.
 *
 * Usage in tests:
 *   import { populateTestBlocks } from
 *     '@pwfabric/runtime/blocks/__test-fixtures__/block-fixtures'
 *   populateTestBlocks()
 *
 * @module @pwfabric/runtime/blocks/__test-fixtures__/block-fixtures
 */

import { z } from 'zod'
import type { BlockDefinition, BlockCategory } from '@pwfabric/core'
import { type BlockRegistry, blockRegistry } from '../registry.js'

// ============================================================
// STUB SCHEMA — every legacy test block accepts arbitrary props
// ============================================================
//
// Tests that exercise the rule engine / composition validation only
// touch `BlockDefinition.canHaveChildren` / `.allowedChildren` /
// `.allowedParents`. Tests that walk `schema.shape` for prop names use
// the shape keys defined per-block below; the schemas are built with
// `z.object(shape).passthrough()` so unknown props don't throw on
// safeParse.
// ============================================================

type PropShape = z.ZodRawShape

function makeDefinition(input: {
  type: string
  name: string
  category: BlockCategory
  shape?: PropShape
  defaultProps?: Record<string, unknown>
  canHaveChildren?: boolean
  allowedChildren?: readonly string[]
  allowedParents?: readonly string[]
}): BlockDefinition {
  const schema = z.object(input.shape ?? {}).passthrough()
  return {
    type: input.type,
    name: input.name,
    category: input.category,
    icon: 'block',
    schema,
    defaultProps: input.defaultProps ?? {},
    canHaveChildren: input.canHaveChildren ?? false,
    ...(input.allowedChildren !== undefined ? { allowedChildren: input.allowedChildren } : {}),
    ...(input.allowedParents !== undefined ? { allowedParents: input.allowedParents } : {}),
  }
}

// Common prop shapes used across stubs. Keys match the runtime block
// authoring contracts so tests that read `schema.shape` for prop names
// still see the expected keys.
const stringProp = z.string().optional()
const numberProp = z.number().optional()
const booleanProp = z.boolean().optional()
const anyArrayProp = z.array(z.unknown()).optional()
const styleProp = z.record(z.unknown()).optional()

// Helper for blocks whose schema would otherwise be empty — keeps tests
// that walk `Object.keys(schema.shape)` from observing zero props.
const baseShape: PropShape = {
  className: stringProp,
  style: styleProp,
}

// ============================================================
// 45 LEGACY BLOCK DEFINITION STUBS
// ============================================================
//
// Order mirrors the historic publish order so any snapshot tests
// observing definition iteration sequence stay stable.
// ============================================================

export const TEST_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  // -------- LAYOUT --------
  makeDefinition({
    type: 'container',
    name: 'Container',
    category: 'layout',
    canHaveChildren: true,
    shape: {
      ...baseShape,
      direction: stringProp,
      gap: numberProp,
      padding: numberProp,
    },
  }),
  makeDefinition({
    type: 'grid',
    name: 'Grid',
    category: 'layout',
    canHaveChildren: true,
    // Historic grid restriction: only structural / content blocks are
    // allowed as direct children. The legacy `gridDefinition` carried an
    // explicit allowed-children list which the rule engine consults
    // before falling back to the cross-block "no nested grids" policy.
    allowedChildren: [
      'container',
      'card',
      'section',
      'image',
      'video',
      'text',
      'heading',
      'button',
      'badge',
      'icon',
      'divider',
      'list',
      'table',
      'stat',
    ],
    shape: {
      ...baseShape,
      columns: numberProp,
      gap: numberProp,
    },
  }),
  makeDefinition({
    type: 'navbar',
    name: 'Navbar',
    category: 'layout',
    canHaveChildren: true,
    shape: { ...baseShape, items: anyArrayProp },
  }),
  makeDefinition({
    type: 'section',
    name: 'Section',
    category: 'layout',
    canHaveChildren: true,
    shape: { ...baseShape, title: stringProp },
  }),

  // -------- PANEL --------
  makeDefinition({
    type: 'accordion',
    name: 'Accordion',
    category: 'panel',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp },
  }),
  makeDefinition({
    type: 'card',
    name: 'Card',
    category: 'panel',
    canHaveChildren: true,
    shape: { ...baseShape, title: stringProp },
  }),
  makeDefinition({
    type: 'drawer',
    name: 'Drawer',
    category: 'panel',
    canHaveChildren: true,
    shape: { ...baseShape, open: booleanProp, side: stringProp },
  }),
  makeDefinition({
    type: 'modal',
    name: 'Modal',
    category: 'panel',
    canHaveChildren: true,
    allowedChildren: [
      'container',
      'grid',
      'text',
      'heading',
      'button',
      'image',
      'form',
      'input',
      'list',
      'table',
      'divider',
      'icon',
      'badge',
    ],
    shape: { ...baseShape, open: booleanProp, title: stringProp },
  }),
  makeDefinition({
    type: 'stepper',
    name: 'Stepper',
    category: 'panel',
    canHaveChildren: false,
    shape: { ...baseShape, steps: anyArrayProp, current: numberProp },
  }),
  makeDefinition({
    type: 'tabs',
    name: 'Tabs',
    category: 'panel',
    canHaveChildren: true,
    allowedChildren: ['container'],
    shape: { ...baseShape, tabs: anyArrayProp, defaultTab: stringProp },
  }),
  makeDefinition({
    type: 'tooltip',
    name: 'Tooltip',
    category: 'panel',
    canHaveChildren: true,
    allowedChildren: ['text', 'button', 'icon', 'badge', 'link'],
    shape: { ...baseShape, content: stringProp },
  }),

  // -------- TEXT --------
  makeDefinition({
    type: 'alert',
    name: 'Alert',
    category: 'text',
    canHaveChildren: false,
    shape: { ...baseShape, message: stringProp, severity: stringProp },
  }),
  makeDefinition({
    type: 'callout',
    name: 'Callout',
    category: 'text',
    canHaveChildren: false,
    shape: { ...baseShape, title: stringProp, body: stringProp },
  }),
  makeDefinition({
    type: 'code',
    name: 'Code',
    category: 'text',
    canHaveChildren: false,
    shape: { ...baseShape, code: stringProp, language: stringProp },
  }),
  makeDefinition({
    type: 'heading',
    name: 'Heading',
    category: 'text',
    canHaveChildren: false,
    shape: { ...baseShape, text: stringProp, level: numberProp },
  }),
  makeDefinition({
    type: 'text',
    name: 'Text',
    category: 'text',
    canHaveChildren: false,
    shape: { ...baseShape, content: stringProp },
  }),

  // -------- DATA --------
  makeDefinition({
    type: 'list',
    name: 'List',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp, style: stringProp },
  }),
  makeDefinition({
    type: 'progress',
    name: 'Progress',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, value: numberProp, max: numberProp },
  }),
  makeDefinition({
    type: 'rating',
    name: 'Rating',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, value: numberProp, max: numberProp },
  }),
  makeDefinition({
    type: 'skeleton',
    name: 'Skeleton',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, lines: numberProp },
  }),
  makeDefinition({
    type: 'stat',
    name: 'Stat',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, label: stringProp, value: stringProp },
  }),
  makeDefinition({
    type: 'table',
    name: 'Table',
    category: 'data',
    canHaveChildren: false,
    shape: {
      ...baseShape,
      columns: anyArrayProp,
      data: anyArrayProp,
    },
  }),
  makeDefinition({
    type: 'timeline',
    name: 'Timeline',
    category: 'data',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp },
  }),

  // -------- CONTROL --------
  makeDefinition({
    type: 'avatar',
    name: 'Avatar',
    category: 'control',
    canHaveChildren: false,
    shape: {
      ...baseShape,
      src: stringProp,
      alt: stringProp,
      shape: z.enum(['circle', 'rounded', 'square']).optional(),
    },
  }),
  makeDefinition({
    type: 'badge',
    name: 'Badge',
    category: 'control',
    canHaveChildren: false,
    shape: {
      ...baseShape,
      text: stringProp,
      variant: z
        .enum(['primary', 'secondary', 'success', 'warning', 'destructive', 'error', 'info'])
        .optional(),
    },
  }),
  makeDefinition({
    type: 'breadcrumb',
    name: 'Breadcrumb',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp },
  }),
  makeDefinition({
    type: 'button',
    name: 'Button',
    category: 'control',
    canHaveChildren: false,
    shape: {
      ...baseShape,
      label: stringProp,
      variant: z.enum(['primary', 'secondary', 'outline', 'ghost', 'destructive']).optional(),
      size: z.enum(['small', 'medium', 'large']).optional(),
      href: stringProp,
      disabled: booleanProp,
    },
  }),
  makeDefinition({
    type: 'divider',
    name: 'Divider',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, orientation: stringProp },
  }),
  makeDefinition({
    type: 'dropdown',
    name: 'Dropdown',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp, label: stringProp },
  }),
  makeDefinition({
    type: 'icon',
    name: 'Icon',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, size: numberProp },
  }),
  makeDefinition({
    type: 'link',
    name: 'Link',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, href: stringProp, label: stringProp },
  }),
  makeDefinition({
    type: 'pagination',
    name: 'Pagination',
    category: 'control',
    canHaveChildren: false,
    shape: { ...baseShape, page: numberProp, pages: numberProp },
  }),

  // -------- MEDIA --------
  makeDefinition({
    type: 'carousel',
    name: 'Carousel',
    category: 'media',
    canHaveChildren: false,
    shape: { ...baseShape, items: anyArrayProp },
  }),
  makeDefinition({
    type: 'embed',
    name: 'Embed',
    category: 'media',
    canHaveChildren: false,
    shape: { ...baseShape, src: stringProp },
  }),
  makeDefinition({
    type: 'image',
    name: 'Image',
    category: 'media',
    canHaveChildren: false,
    shape: { ...baseShape, src: stringProp, alt: stringProp },
  }),
  makeDefinition({
    type: 'video',
    name: 'Video',
    category: 'media',
    canHaveChildren: false,
    shape: { ...baseShape, src: stringProp, autoplay: booleanProp },
  }),

  // -------- FORM --------
  makeDefinition({
    type: 'checkbox',
    name: 'Checkbox',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, label: stringProp, checked: booleanProp },
  }),
  makeDefinition({
    type: 'date-input',
    name: 'Date Input',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, value: stringProp },
  }),
  makeDefinition({
    type: 'form',
    name: 'Form',
    category: 'form',
    canHaveChildren: true,
    allowedChildren: [
      'input',
      'textarea',
      'select',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'file-upload',
      'button',
      'text',
      'heading',
      'container',
      'divider',
    ],
    shape: { ...baseShape, action: stringProp, method: stringProp },
  }),
  makeDefinition({
    type: 'input',
    name: 'Input',
    category: 'form',
    canHaveChildren: false,
    allowedParents: ['form', 'container'],
    shape: {
      ...baseShape,
      name: stringProp,
      type: z
        .enum([
          'text',
          'email',
          'password',
          'number',
          'tel',
          'url',
          'date',
          'time',
          'datetime-local',
          'search',
        ])
        .optional(),
      label: stringProp,
      placeholder: stringProp,
    },
  }),
  makeDefinition({
    type: 'radio',
    name: 'Radio',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, value: stringProp, label: stringProp },
  }),
  makeDefinition({
    type: 'select',
    name: 'Select',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, options: anyArrayProp },
  }),
  makeDefinition({
    type: 'tag-input',
    name: 'Tag Input',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, tags: anyArrayProp },
  }),
  makeDefinition({
    type: 'textarea',
    name: 'Textarea',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, rows: numberProp, label: stringProp },
  }),
  makeDefinition({
    type: 'toggle',
    name: 'Toggle',
    category: 'form',
    canHaveChildren: false,
    shape: { ...baseShape, name: stringProp, checked: booleanProp, label: stringProp },
  }),
]

/**
 * Register the 45 block definition stubs on the supplied registry
 * (or the runtime singleton when omitted). Idempotent — skips
 * definitions whose `type` is already registered.
 *
 * Tests that exercise registry-dependent behaviour call this once at
 * module-load. Production code must use the install pipeline instead.
 */
export function populateTestBlocks(target: BlockRegistry = blockRegistry): void {
  for (const def of TEST_BLOCK_DEFINITIONS) {
    if (!target.has(def.type)) target.register(def)
  }
}
