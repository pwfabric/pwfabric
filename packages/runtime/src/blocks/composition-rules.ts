/**
 * Composition Rules
 *
 * CP7: Rules defining valid block compositions
 *
 * @module @pwfabric/core/blocks/composition-rules
 */

import type { CompositionRule } from '@pwfabric/core'
import { MAX_NESTING_DEPTH } from '@pwfabric/core'

// ============================================================
// BUILT-IN RULES
// ============================================================

/**
 * Maximum nesting depth rule
 *
 * Prevents blocks from being nested too deeply.
 */
export const maxDepthRule: CompositionRule = {
  type: 'max_depth',
  description: `Blocks cannot be nested more than ${MAX_NESTING_DEPTH} levels deep`,
  appliesTo: '*',
  config: {
    maxDepth: MAX_NESTING_DEPTH,
  },
}

/**
 * Form children rule
 *
 * Forms can contain all form input elements plus structural/content blocks.
 */
export const formChildrenRule: CompositionRule = {
  type: 'allowed_children',
  description:
    'Forms can contain form input elements and structural/content blocks (text, heading, container, divider, button)',
  appliesTo: 'form',
  config: {
    allowedChildren: [
      // Form input elements — the form family of the first-party base pack as
      // shipped, so every field a form pattern uses passes validation.
      'input',
      'textarea',
      'select',
      'checkbox',
      'radio',
      'toggle',
      'slider',
      'combobox',
      'date-input',
      'file-dropzone',
      'number-stepper',
      'otp-input',
      'rich-text-editor',
      'segmented-control',
      'tag-input',
      // legacy names kept so older documents keep validating
      'switch',
      'file-upload',
      // Structural / content blocks valid inside forms
      'button',
      'text',
      'heading',
      'container',
      'divider',
      'badge',
      'icon',
      'link',
      'alert',
    ],
  },
}

/**
 * Grid children rule
 *
 * Grids cannot have nested grids as direct children.
 */
export const gridChildrenRule: CompositionRule = {
  type: 'allowed_children',
  description: 'Grids cannot contain other grids as direct children',
  appliesTo: 'grid',
  config: {
    disallowedChildren: ['grid'],
  },
}

/**
 * Button no children rule
 *
 * Buttons cannot have children.
 */
export const buttonNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Buttons cannot have children',
  appliesTo: 'button',
  config: {},
}

/**
 * Text no children rule
 *
 * Text blocks cannot have children.
 */
export const textNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Text blocks cannot have children',
  appliesTo: 'text',
  config: {},
}

/**
 * Heading no children rule
 *
 * Heading blocks cannot have children.
 */
export const headingNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Heading blocks cannot have children',
  appliesTo: 'heading',
  config: {},
}

/**
 * Image no children rule
 *
 * Image blocks cannot have children.
 */
export const imageNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Image blocks cannot have children',
  appliesTo: 'image',
  config: {},
}

/**
 * Input no children rule
 *
 * Input blocks cannot have children.
 */
export const inputNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Input blocks cannot have children',
  appliesTo: 'input',
  config: {},
}

/**
 * Input required parent rule
 *
 * Inputs should be inside forms or containers.
 */
export const inputParentRule: CompositionRule = {
  type: 'allowed_parents',
  description: 'Inputs should be placed inside forms or containers',
  appliesTo: 'input',
  config: {
    allowedParents: ['form', 'container'],
    severity: 'warning',
  },
}

/**
 * Link no children rule
 *
 * Link blocks cannot have children.
 */
export const linkNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Link blocks cannot have children',
  appliesTo: 'link',
  config: {},
}

/**
 * Icon no children rule
 *
 * Icon blocks cannot have children.
 */
export const iconNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Icon blocks cannot have children',
  appliesTo: 'icon',
  config: {},
}

/**
 * Badge no children rule
 *
 * Badge blocks cannot have children.
 */
export const badgeNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Badge blocks cannot have children',
  appliesTo: 'badge',
  config: {},
}

/**
 * Code no children rule
 *
 * Code blocks cannot have children.
 */
export const codeNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Code blocks cannot have children',
  appliesTo: 'code',
  config: {},
}

/**
 * Divider no children rule
 *
 * Divider blocks cannot have children.
 */
export const dividerNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Divider blocks cannot have children',
  appliesTo: 'divider',
  config: {},
}

/**
 * List no children rule
 *
 * List blocks cannot have children.
 */
export const listNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'List blocks cannot have children',
  appliesTo: 'list',
  config: {},
}

/**
 * Table no children rule
 *
 * Table blocks cannot have children.
 */
export const tableNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Table blocks cannot have children',
  appliesTo: 'table',
  config: {},
}

// ============================================================
// INTERACTIVE BLOCK RULES
// ============================================================

/**
 * Accordion no children rule
 *
 * Accordion items are defined via props, not children.
 */
export const accordionNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Accordion items are defined via props, not as children blocks',
  appliesTo: 'accordion',
  config: {},
}

/**
 * Dropdown no children rule
 *
 * Dropdown items are defined via props, not children.
 */
export const dropdownNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Dropdown items are defined via props, not as children blocks',
  appliesTo: 'dropdown',
  config: {},
}

/**
 * Avatar no children rule
 *
 * Avatar is a leaf block with no children.
 */
export const avatarNoChildrenRule: CompositionRule = {
  type: 'no_children',
  description: 'Avatar blocks cannot have children',
  appliesTo: 'avatar',
  config: {},
}

/**
 * Tooltip children rule
 *
 * Tooltip can wrap specific inline/interactive blocks.
 */
export const tooltipChildrenRule: CompositionRule = {
  type: 'allowed_children',
  description: 'Tooltips can only wrap text, buttons, icons, badges, and links',
  appliesTo: 'tooltip',
  config: {
    allowedChildren: ['text', 'button', 'icon', 'badge', 'link'],
  },
}

/**
 * Tabs children rule
 *
 * Tabs can contain containers as tab panels.
 */
export const tabsChildrenRule: CompositionRule = {
  type: 'allowed_children',
  description: 'Tabs can only contain containers as tab panel content',
  appliesTo: 'tabs',
  config: {
    allowedChildren: ['container'],
  },
}

/**
 * Modal children rule
 *
 * Modal can contain layout and content blocks.
 */
export const modalChildrenRule: CompositionRule = {
  type: 'allowed_children',
  description: 'Modals can contain layout and content blocks',
  appliesTo: 'modal',
  config: {
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
  },
}

/**
 * No self nesting rule
 *
 * Blocks cannot be nested inside themselves.
 */
export const noSelfNestingRule: CompositionRule = {
  type: 'no_self_nesting',
  description: 'Blocks cannot be nested inside themselves',
  appliesTo: '*',
  config: {},
}

// ============================================================
// ALL RULES
// ============================================================

/**
 * All composition rules
 */
export const compositionRules: readonly CompositionRule[] = [
  maxDepthRule,
  formChildrenRule,
  gridChildrenRule,
  // Content blocks - no children
  buttonNoChildrenRule,
  textNoChildrenRule,
  headingNoChildrenRule,
  linkNoChildrenRule,
  iconNoChildrenRule,
  badgeNoChildrenRule,
  codeNoChildrenRule,
  dividerNoChildrenRule,
  // Layout blocks - no children (leaf)
  listNoChildrenRule,
  tableNoChildrenRule,
  // Media blocks - no children
  imageNoChildrenRule,
  // Form blocks - no children
  inputNoChildrenRule,
  inputParentRule,
  // Interactive blocks
  accordionNoChildrenRule,
  dropdownNoChildrenRule,
  avatarNoChildrenRule,
  tooltipChildrenRule,
  tabsChildrenRule,
  modalChildrenRule,
  // Universal rules
  noSelfNestingRule,
] as const

/**
 * Get rules that apply to a specific block type
 *
 * @param blockType - Block type to get rules for
 * @returns Array of applicable rules
 */
export function getRulesForBlockType(blockType: string): readonly CompositionRule[] {
  return compositionRules.filter((rule) => rule.appliesTo === '*' || rule.appliesTo === blockType)
}

/**
 * Get rules by type
 *
 * @param ruleType - Rule type to filter by
 * @returns Array of matching rules
 */
export function getRulesByType(ruleType: CompositionRule['type']): readonly CompositionRule[] {
  return compositionRules.filter((rule) => rule.type === ruleType)
}

// ============================================================
// CANONICAL CHILD SETS (single source of truth)
// Import these in API validator instead of redeclaring.
// ============================================================

/** Allowed direct children of a tabs block */
export const TABS_ALLOWED_CHILDREN = new Set(tabsChildrenRule.config.allowedChildren as string[])

/** Allowed direct children of a form block */
export const FORM_ALLOWED_CHILDREN = new Set(formChildrenRule.config.allowedChildren as string[])
