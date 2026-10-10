/**
 * Three small fixture blocks for the golden-output tests.
 *
 * Kept as source strings rather than files on disk: the compiler is in-memory,
 * and the fixtures should prove that without a filesystem in the loop.
 */

/** A plain block: no imports at all, a definition object and a component function. */
export const PLAIN_BLOCK = {
  entry: 'blocks/content/plain/component.tsx',
  files: {
    'blocks/content/plain/component.tsx': `export const definition = {
  type: 'content.plain',
  schema: { kind: 'object' },
  defaultProps: { text: 'Hello' },
  canHaveChildren: false,
}

export default function Plain(props: { text: string }): string {
  return 'plain:' + props.text
}
`,
  },
}

/** A block importing a companion from `atoms/lib/` (and a `_shared-*` sibling). */
export const LIB_BLOCK = {
  entry: 'atoms/blocks/content/greeting/component.tsx',
  companions: ['atoms/lib/format.ts', 'atoms/blocks/content/greeting/_shared-copy.ts'],
  files: {
    'atoms/blocks/content/greeting/component.tsx': `import { shout } from '../../../lib/format.js'
import { GREETING } from './_shared-copy'

export const definition = {
  type: 'content.greeting',
  schema: { kind: 'object' },
  defaultProps: { name: 'world' },
  canHaveChildren: false,
}

export function Greeting(props: { name: string }): string {
  return shout(GREETING + ', ' + props.name)
}
`,
    'atoms/lib/format.ts': `export function shout(s: string): string {
  return s.toUpperCase() + '!'
}
export function unused(): number {
  return 42
}
`,
    'atoms/blocks/content/greeting/_shared-copy.ts': `export const GREETING = 'hello'
`,
    'atoms/blocks/content/other/component.tsx': `export const notPartOfThisAtom = true
`,
  },
}

/** A block importing host-provided modules: react (JSX), zod and the runtime. */
export const HOST_BLOCK = {
  entry: 'blocks/data/card/component.tsx',
  files: {
    'blocks/data/card/component.tsx': `import { z } from 'zod'
import { useState } from 'react'
import { useSurfaceEvents } from '@pwfabric/runtime'
import type { BlockDefinition } from '@pwfabric/core'
import type { BlockComponent } from '../../component-types.js'

export const propsSchema = z.object({ title: z.string().default('Card') })

export const definition: BlockDefinition = {
  type: 'data.card',
  name: 'Card',
  category: 'data',
  schema: propsSchema,
  defaultProps: { title: 'Card' },
  canHaveChildren: false,
} as unknown as BlockDefinition

export const Card: BlockComponent = ({ props }) => {
  const [open, setOpen] = useState(false)
  const { emit } = useSurfaceEvents()
  return (
    <section onClick={() => { setOpen(!open); emit('card.toggled', { open }) }}>
      <h2>{props.title}</h2>
    </section>
  )
}
`,
  },
}
