/**
 * Composition Rules Tests — @pwfabric/runtime/blocks
 *
 * Tests for the named composition rule objects and the getRulesForBlockType /
 * getRulesByType utility functions.
 *
 * @module @pwfabric/runtime/blocks/__tests__/composition-rules
 */

import { describe, it, expect } from 'vitest'
import {
  compositionRules,
  maxDepthRule,
  formChildrenRule,
  gridChildrenRule,
  buttonNoChildrenRule,
  textNoChildrenRule,
  headingNoChildrenRule,
  imageNoChildrenRule,
  inputNoChildrenRule,
  inputParentRule,
  linkNoChildrenRule,
  iconNoChildrenRule,
  badgeNoChildrenRule,
  codeNoChildrenRule,
  dividerNoChildrenRule,
  listNoChildrenRule,
  tableNoChildrenRule,
  accordionNoChildrenRule,
  dropdownNoChildrenRule,
  avatarNoChildrenRule,
  tooltipChildrenRule,
  tabsChildrenRule,
  modalChildrenRule,
  noSelfNestingRule,
  getRulesForBlockType,
  getRulesByType,
} from '../index.js'

// ============================================================
// compositionRules — array completeness
// ============================================================

describe('compositionRules', () => {
  it('should be a non-empty readonly array', () => {
    expect(compositionRules.length).toBeGreaterThan(0)
  })

  it('should include the maxDepthRule', () => {
    expect(compositionRules).toContain(maxDepthRule)
  })

  it('should include the formChildrenRule', () => {
    expect(compositionRules).toContain(formChildrenRule)
  })

  it('should include the gridChildrenRule', () => {
    expect(compositionRules).toContain(gridChildrenRule)
  })

  it('should include no-children rules for leaf blocks', () => {
    expect(compositionRules).toContain(buttonNoChildrenRule)
    expect(compositionRules).toContain(textNoChildrenRule)
    expect(compositionRules).toContain(headingNoChildrenRule)
    expect(compositionRules).toContain(imageNoChildrenRule)
    expect(compositionRules).toContain(inputNoChildrenRule)
    expect(compositionRules).toContain(linkNoChildrenRule)
    expect(compositionRules).toContain(iconNoChildrenRule)
    expect(compositionRules).toContain(badgeNoChildrenRule)
    expect(compositionRules).toContain(codeNoChildrenRule)
    expect(compositionRules).toContain(dividerNoChildrenRule)
    expect(compositionRules).toContain(listNoChildrenRule)
    expect(compositionRules).toContain(tableNoChildrenRule)
  })

  it('should include interactive block rules', () => {
    expect(compositionRules).toContain(accordionNoChildrenRule)
    expect(compositionRules).toContain(dropdownNoChildrenRule)
    expect(compositionRules).toContain(avatarNoChildrenRule)
    expect(compositionRules).toContain(tooltipChildrenRule)
    expect(compositionRules).toContain(tabsChildrenRule)
    expect(compositionRules).toContain(modalChildrenRule)
  })

  it('should include the noSelfNestingRule', () => {
    expect(compositionRules).toContain(noSelfNestingRule)
  })

  it('should include the inputParentRule', () => {
    expect(compositionRules).toContain(inputParentRule)
  })
})

// ============================================================
// Individual rule structure
// ============================================================

describe('maxDepthRule', () => {
  it('should apply to all blocks', () => {
    expect(maxDepthRule.appliesTo).toBe('*')
  })

  it('should be of type max_depth', () => {
    expect(maxDepthRule.type).toBe('max_depth')
  })

  it('should have a maxDepth config value', () => {
    expect(maxDepthRule.config).toHaveProperty('maxDepth')
    expect(typeof (maxDepthRule.config as { maxDepth: number }).maxDepth).toBe('number')
  })
})

describe('formChildrenRule', () => {
  it('should apply to the form block', () => {
    expect(formChildrenRule.appliesTo).toBe('form')
  })

  it('should be of type allowed_children', () => {
    expect(formChildrenRule.type).toBe('allowed_children')
  })

  it('should allow input and button as form children', () => {
    const allowed = (formChildrenRule.config as { allowedChildren: string[] }).allowedChildren
    expect(allowed).toContain('input')
    expect(allowed).toContain('button')
  })
})

describe('gridChildrenRule', () => {
  it('should apply to the grid block', () => {
    expect(gridChildrenRule.appliesTo).toBe('grid')
  })

  it('should be of type allowed_children', () => {
    expect(gridChildrenRule.type).toBe('allowed_children')
  })

  it('should disallow grid as a direct child', () => {
    const disallowed = (gridChildrenRule.config as { disallowedChildren: string[] })
      .disallowedChildren
    expect(disallowed).toContain('grid')
  })
})

describe('buttonNoChildrenRule', () => {
  it('should apply to the button block', () => {
    expect(buttonNoChildrenRule.appliesTo).toBe('button')
  })

  it('should be of type no_children', () => {
    expect(buttonNoChildrenRule.type).toBe('no_children')
  })
})

describe('inputParentRule', () => {
  it('should apply to the input block', () => {
    expect(inputParentRule.appliesTo).toBe('input')
  })

  it('should be of type allowed_parents', () => {
    expect(inputParentRule.type).toBe('allowed_parents')
  })

  it('should list form and container as allowed parents', () => {
    const allowed = (inputParentRule.config as { allowedParents: string[] }).allowedParents
    expect(allowed).toContain('form')
    expect(allowed).toContain('container')
  })

  it('should carry a warning severity', () => {
    expect((inputParentRule.config as { severity: string }).severity).toBe('warning')
  })
})

describe('tooltipChildrenRule', () => {
  it('should apply to the tooltip block', () => {
    expect(tooltipChildrenRule.appliesTo).toBe('tooltip')
  })

  it('should be of type allowed_children', () => {
    expect(tooltipChildrenRule.type).toBe('allowed_children')
  })

  it('should allow text, button, icon, badge, and link', () => {
    const allowed = (tooltipChildrenRule.config as { allowedChildren: string[] }).allowedChildren
    expect(allowed).toContain('text')
    expect(allowed).toContain('button')
    expect(allowed).toContain('icon')
    expect(allowed).toContain('badge')
    expect(allowed).toContain('link')
  })
})

describe('tabsChildrenRule', () => {
  it('should apply to the tabs block', () => {
    expect(tabsChildrenRule.appliesTo).toBe('tabs')
  })

  it('should only allow container as child', () => {
    const allowed = (tabsChildrenRule.config as { allowedChildren: string[] }).allowedChildren
    expect(allowed).toContain('container')
    expect(allowed).toHaveLength(1)
  })
})

describe('modalChildrenRule', () => {
  it('should apply to the modal block', () => {
    expect(modalChildrenRule.appliesTo).toBe('modal')
  })

  it('should allow container, grid, text, and heading', () => {
    const allowed = (modalChildrenRule.config as { allowedChildren: string[] }).allowedChildren
    expect(allowed).toContain('container')
    expect(allowed).toContain('grid')
    expect(allowed).toContain('text')
    expect(allowed).toContain('heading')
  })
})

describe('noSelfNestingRule', () => {
  it('should apply to all blocks', () => {
    expect(noSelfNestingRule.appliesTo).toBe('*')
  })

  it('should be of type no_self_nesting', () => {
    expect(noSelfNestingRule.type).toBe('no_self_nesting')
  })
})

// ============================================================
// getRulesForBlockType
// ============================================================

describe('getRulesForBlockType', () => {
  it('should return rules that apply to a specific block type', () => {
    const formRules = getRulesForBlockType('form')

    expect(formRules).toContain(formChildrenRule)
  })

  it('should always include wildcard (*) rules', () => {
    const buttonRules = getRulesForBlockType('button')

    expect(buttonRules).toContain(maxDepthRule)
    expect(buttonRules).toContain(noSelfNestingRule)
  })

  it('should not include rules for unrelated block types', () => {
    const gridRules = getRulesForBlockType('grid')

    expect(gridRules).not.toContain(formChildrenRule)
    expect(gridRules).not.toContain(buttonNoChildrenRule)
  })

  it('should return an empty array for a type with no specific rules', () => {
    // A completely unknown type has no specific rules, but universal (*) rules apply
    const rules = getRulesForBlockType('unknown-hypothetical-type')

    // Only wildcard rules should be returned
    const nonWildcard = rules.filter((r) => r.appliesTo !== '*')
    expect(nonWildcard).toHaveLength(0)
  })

  it('should return input-specific rules for input', () => {
    const inputRules = getRulesForBlockType('input')

    expect(inputRules).toContain(inputNoChildrenRule)
    expect(inputRules).toContain(inputParentRule)
  })
})

// ============================================================
// getRulesByType
// ============================================================

describe('getRulesByType', () => {
  it('should return all no_children rules', () => {
    const noChildrenRules = getRulesByType('no_children')

    expect(noChildrenRules.length).toBeGreaterThan(0)
    expect(noChildrenRules.every((r) => r.type === 'no_children')).toBe(true)
    expect(noChildrenRules).toContain(buttonNoChildrenRule)
    expect(noChildrenRules).toContain(textNoChildrenRule)
    expect(noChildrenRules).toContain(imageNoChildrenRule)
  })

  it('should return all allowed_children rules', () => {
    const allowedChildrenRules = getRulesByType('allowed_children')

    expect(allowedChildrenRules.length).toBeGreaterThan(0)
    expect(allowedChildrenRules.every((r) => r.type === 'allowed_children')).toBe(true)
    expect(allowedChildrenRules).toContain(formChildrenRule)
    expect(allowedChildrenRules).toContain(gridChildrenRule)
  })

  it('should return the single max_depth rule', () => {
    const maxDepthRules = getRulesByType('max_depth')

    expect(maxDepthRules).toHaveLength(1)
    expect(maxDepthRules[0]).toBe(maxDepthRule)
  })

  it('should return the single no_self_nesting rule', () => {
    const selfNestingRules = getRulesByType('no_self_nesting')

    expect(selfNestingRules).toHaveLength(1)
    expect(selfNestingRules[0]).toBe(noSelfNestingRule)
  })

  it('should return the allowed_parents rules', () => {
    const parentRules = getRulesByType('allowed_parents')

    expect(parentRules.length).toBeGreaterThan(0)
    expect(parentRules).toContain(inputParentRule)
  })
})
