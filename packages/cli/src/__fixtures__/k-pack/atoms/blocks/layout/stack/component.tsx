import { z } from 'zod'
import * as React from 'react'

export const stackPropsSchema = z.object({ gap: z.string().default('16px') })

export const stackDefinition = {
  type: 'stack',
  name: 'Stack',
  schema: stackPropsSchema,
  defaultProps: { gap: '16px' },
}

export default function Stack(props: { props?: { gap?: string }; children?: React.ReactNode }): React.ReactElement {
  return <div data-k="stack" style={{ display: 'flex', flexDirection: 'column', gap: props.props?.gap ?? '16px' }}>{props.children}</div>
}
