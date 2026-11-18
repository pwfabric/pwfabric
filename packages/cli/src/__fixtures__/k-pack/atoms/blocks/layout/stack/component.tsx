import * as React from 'react'

export const stackDefinition = {
  type: 'stack',
  name: 'Stack',
  defaultProps: { gap: '16px' },
}

export default function Stack(props: { props?: { gap?: string }; children?: React.ReactNode }): React.ReactElement {
  return <div data-k="stack" style={{ display: 'flex', flexDirection: 'column', gap: props.props?.gap ?? '16px' }}>{props.children}</div>
}
