/**
 * Built-in Primitives
 *
 * Core primitive definitions for the runtime
 *
 * These are the built-in primitives that the runtime knows how to render.
 * Each primitive has a defined contract for its props.
 *
 * @module @pwfabric/runtime/surface/primitives
 */

import type { PrimitiveType, RenderNode, BaseNodeProps } from './types.js'
import { createNode } from './types.js'

// ============================================================
// PRIMITIVE DEFINITIONS
// ============================================================

/**
 * Text primitive props
 */
export interface TextProps extends BaseNodeProps {
  readonly content: string
  readonly variant?: 'body' | 'caption' | 'label'
  readonly weight?: 'normal' | 'medium' | 'bold'
  readonly truncate?: boolean
}

/**
 * Container primitive props
 */
export interface ContainerProps extends BaseNodeProps {
  readonly direction?: 'row' | 'column'
  readonly align?: 'start' | 'center' | 'end' | 'stretch'
  readonly justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  readonly gap?: number | string
  readonly padding?: number | string
  readonly wrap?: boolean
}

/**
 * Button primitive props
 */
export interface ButtonProps extends BaseNodeProps {
  readonly label: string
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  readonly size?: 'sm' | 'md' | 'lg'
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly onClick?: string // Expression or capability reference
}

/**
 * Input primitive props
 */
export interface InputProps extends BaseNodeProps {
  readonly name: string
  readonly type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'
  readonly placeholder?: string
  readonly value?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly onChange?: string
}

/**
 * Image primitive props
 */
export interface ImageProps extends BaseNodeProps {
  readonly src: string
  readonly alt: string
  readonly width?: number | string
  readonly height?: number | string
  readonly loading?: 'eager' | 'lazy'
  readonly fit?: 'contain' | 'cover' | 'fill' | 'none'
}

/**
 * Link primitive props
 */
export interface LinkProps extends BaseNodeProps {
  readonly href: string
  readonly target?: '_self' | '_blank' | '_parent' | '_top'
  readonly rel?: string
}

/**
 * List primitive props
 */
export interface ListProps extends BaseNodeProps {
  readonly type?: 'ordered' | 'unordered'
  readonly marker?: 'disc' | 'circle' | 'square' | 'decimal' | 'none'
}

/**
 * Heading primitive props
 */
export interface HeadingProps extends BaseNodeProps {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6
  readonly content: string
}

/**
 * Spacer primitive props
 */
export interface SpacerProps extends BaseNodeProps {
  readonly size: number | string
  readonly direction?: 'horizontal' | 'vertical'
}

/**
 * Divider primitive props
 */
export interface DividerProps extends BaseNodeProps {
  readonly orientation?: 'horizontal' | 'vertical'
  readonly variant?: 'solid' | 'dashed' | 'dotted'
}

/**
 * Slot primitive props - placeholder for injected content
 */
export interface SlotProps extends BaseNodeProps {
  readonly name: string
  readonly fallback?: readonly RenderNode[]
}

/**
 * Conditional primitive props
 */
export interface ConditionalProps extends BaseNodeProps {
  readonly condition: string // Expression
  readonly then?: readonly RenderNode[]
  readonly else?: readonly RenderNode[]
}

/**
 * Loop primitive props
 */
export interface LoopProps extends BaseNodeProps {
  readonly items: string // Expression
  readonly as: string
  readonly keyExpr?: string
}

// ============================================================
// PRIMITIVE REGISTRY
// ============================================================

/**
 * Primitive definition
 */
export interface PrimitiveDefinition {
  readonly type: PrimitiveType
  readonly name: string
  readonly description: string
  readonly props: Record<string, PropDefinition>
  readonly allowsChildren: boolean
}

/**
 * Property definition
 */
export interface PropDefinition {
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'expression'
  readonly required: boolean
  readonly description: string
  readonly defaultValue?: unknown
  readonly oneOf?: readonly unknown[]
}

/**
 * Built-in primitive definitions
 */
export const PRIMITIVE_DEFINITIONS: Record<PrimitiveType, PrimitiveDefinition> = {
  text: {
    type: 'text',
    name: 'Text',
    description: 'Display text content',
    props: {
      content: { type: 'string', required: true, description: 'Text content to display' },
      variant: {
        type: 'string',
        required: false,
        description: 'Text variant',
        oneOf: ['body', 'caption', 'label'],
        defaultValue: 'body',
      },
      weight: {
        type: 'string',
        required: false,
        description: 'Font weight',
        oneOf: ['normal', 'medium', 'bold'],
        defaultValue: 'normal',
      },
      truncate: {
        type: 'boolean',
        required: false,
        description: 'Truncate with ellipsis',
        defaultValue: false,
      },
    },
    allowsChildren: false,
  },

  container: {
    type: 'container',
    name: 'Container',
    description: 'Layout container for child elements',
    props: {
      direction: {
        type: 'string',
        required: false,
        description: 'Flex direction',
        oneOf: ['row', 'column'],
        defaultValue: 'column',
      },
      align: {
        type: 'string',
        required: false,
        description: 'Align items',
        oneOf: ['start', 'center', 'end', 'stretch'],
      },
      justify: {
        type: 'string',
        required: false,
        description: 'Justify content',
        oneOf: ['start', 'center', 'end', 'between', 'around'],
      },
      gap: { type: 'string', required: false, description: 'Gap between children' },
      padding: { type: 'string', required: false, description: 'Container padding' },
      wrap: { type: 'boolean', required: false, description: 'Wrap children', defaultValue: false },
    },
    allowsChildren: true,
  },

  button: {
    type: 'button',
    name: 'Button',
    description: 'Interactive button element',
    props: {
      label: { type: 'string', required: true, description: 'Button label' },
      variant: {
        type: 'string',
        required: false,
        description: 'Button style variant',
        oneOf: ['primary', 'secondary', 'ghost', 'danger'],
        defaultValue: 'primary',
      },
      size: {
        type: 'string',
        required: false,
        description: 'Button size',
        oneOf: ['sm', 'md', 'lg'],
        defaultValue: 'md',
      },
      disabled: { type: 'boolean', required: false, description: 'Disable button' },
      loading: { type: 'boolean', required: false, description: 'Show loading state' },
      onClick: { type: 'expression', required: false, description: 'Click handler expression' },
    },
    allowsChildren: false,
  },

  input: {
    type: 'input',
    name: 'Input',
    description: 'Text input field',
    props: {
      name: { type: 'string', required: true, description: 'Input name' },
      type: {
        type: 'string',
        required: false,
        description: 'Input type',
        oneOf: ['text', 'email', 'password', 'number', 'tel', 'url'],
        defaultValue: 'text',
      },
      placeholder: { type: 'string', required: false, description: 'Placeholder text' },
      value: { type: 'string', required: false, description: 'Current value' },
      disabled: { type: 'boolean', required: false, description: 'Disable input' },
      required: { type: 'boolean', required: false, description: 'Mark as required' },
      onChange: { type: 'expression', required: false, description: 'Change handler expression' },
    },
    allowsChildren: false,
  },

  image: {
    type: 'image',
    name: 'Image',
    description: 'Display an image',
    props: {
      src: { type: 'string', required: true, description: 'Image source URL' },
      alt: { type: 'string', required: true, description: 'Alt text for accessibility' },
      width: { type: 'string', required: false, description: 'Image width' },
      height: { type: 'string', required: false, description: 'Image height' },
      loading: {
        type: 'string',
        required: false,
        description: 'Loading strategy',
        oneOf: ['eager', 'lazy'],
        defaultValue: 'lazy',
      },
      fit: {
        type: 'string',
        required: false,
        description: 'Object fit',
        oneOf: ['contain', 'cover', 'fill', 'none'],
      },
    },
    allowsChildren: false,
  },

  link: {
    type: 'link',
    name: 'Link',
    description: 'Navigation link',
    props: {
      href: { type: 'string', required: true, description: 'Link destination' },
      target: {
        type: 'string',
        required: false,
        description: 'Link target',
        oneOf: ['_self', '_blank', '_parent', '_top'],
      },
      rel: { type: 'string', required: false, description: 'Link relationship' },
    },
    allowsChildren: true,
  },

  list: {
    type: 'list',
    name: 'List',
    description: 'List container',
    props: {
      type: {
        type: 'string',
        required: false,
        description: 'List type',
        oneOf: ['ordered', 'unordered'],
        defaultValue: 'unordered',
      },
      marker: {
        type: 'string',
        required: false,
        description: 'List marker style',
        oneOf: ['disc', 'circle', 'square', 'decimal', 'none'],
      },
    },
    allowsChildren: true,
  },

  'list-item': {
    type: 'list-item',
    name: 'List Item',
    description: 'Item within a list',
    props: {},
    allowsChildren: true,
  },

  heading: {
    type: 'heading',
    name: 'Heading',
    description: 'Section heading',
    props: {
      level: {
        type: 'number',
        required: true,
        description: 'Heading level (1-6)',
        oneOf: [1, 2, 3, 4, 5, 6],
      },
      content: { type: 'string', required: true, description: 'Heading text' },
    },
    allowsChildren: false,
  },

  paragraph: {
    type: 'paragraph',
    name: 'Paragraph',
    description: 'Text paragraph',
    props: {},
    allowsChildren: true,
  },

  spacer: {
    type: 'spacer',
    name: 'Spacer',
    description: 'Empty space',
    props: {
      size: { type: 'string', required: true, description: 'Space size' },
      direction: {
        type: 'string',
        required: false,
        description: 'Space direction',
        oneOf: ['horizontal', 'vertical'],
        defaultValue: 'vertical',
      },
    },
    allowsChildren: false,
  },

  divider: {
    type: 'divider',
    name: 'Divider',
    description: 'Visual separator',
    props: {
      orientation: {
        type: 'string',
        required: false,
        description: 'Divider orientation',
        oneOf: ['horizontal', 'vertical'],
        defaultValue: 'horizontal',
      },
      variant: {
        type: 'string',
        required: false,
        description: 'Divider style',
        oneOf: ['solid', 'dashed', 'dotted'],
        defaultValue: 'solid',
      },
    },
    allowsChildren: false,
  },

  slot: {
    type: 'slot',
    name: 'Slot',
    description: 'Named slot for content injection',
    props: {
      name: { type: 'string', required: true, description: 'Slot name' },
    },
    allowsChildren: true, // Children are fallback content
  },

  fragment: {
    type: 'fragment',
    name: 'Fragment',
    description: 'Invisible wrapper for multiple children',
    props: {},
    allowsChildren: true,
  },

  conditional: {
    type: 'conditional',
    name: 'Conditional',
    description: 'Conditionally render content',
    props: {
      condition: { type: 'expression', required: true, description: 'Condition expression' },
    },
    allowsChildren: true,
  },

  loop: {
    type: 'loop',
    name: 'Loop',
    description: 'Iterate over items',
    props: {
      items: { type: 'expression', required: true, description: 'Items expression' },
      as: { type: 'string', required: true, description: 'Item variable name' },
      keyExpr: { type: 'expression', required: false, description: 'Key expression' },
    },
    allowsChildren: true,
  },
}

// ============================================================
// PRIMITIVE FACTORY FUNCTIONS
// ============================================================

/**
 * Create a text node
 */
export function text(content: string, props?: Omit<TextProps, 'content'>): RenderNode {
  return createNode('text', { content, ...props })
}

/**
 * Create a container node
 */
export function container(children: readonly RenderNode[], props?: ContainerProps): RenderNode {
  return createNode('container', props ? { ...props } : {}, children)
}

/**
 * Create a button node
 */
export function button(label: string, props?: Omit<ButtonProps, 'label'>): RenderNode {
  return createNode('button', { label, ...props })
}

/**
 * Create a heading node
 */
export function heading(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  content: string,
  props?: Omit<HeadingProps, 'level' | 'content'>
): RenderNode {
  return createNode('heading', { level, content, ...props })
}

/**
 * Create a spacer node
 */
export function spacer(size: number | string, direction?: 'horizontal' | 'vertical'): RenderNode {
  return createNode('spacer', { size, direction })
}

/**
 * Create a divider node
 */
export function divider(props?: DividerProps): RenderNode {
  return createNode('divider', props ? { ...props } : {})
}

/**
 * Check if a type is a known primitive
 */
export function isPrimitive(type: string): type is PrimitiveType {
  return type in PRIMITIVE_DEFINITIONS
}

/**
 * Get primitive definition
 */
export function getPrimitiveDefinition(type: PrimitiveType): PrimitiveDefinition | undefined {
  return PRIMITIVE_DEFINITIONS[type]
}
