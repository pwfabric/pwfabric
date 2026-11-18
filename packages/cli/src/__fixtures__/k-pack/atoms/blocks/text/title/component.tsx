import * as React from 'react'
import { clean } from '../../../lib/_shared-text.js'

export const titleDefinition = {
  type: 'title',
  name: 'Title',
  defaultProps: { text: '' },
}

export default function Title(props: { props?: { text?: string }; text?: string }): React.ReactElement {
  const text = clean(props.props?.text ?? props.text)
  return <h1 data-k="title" style={{ color: 'var(--pw-color-primary)' }}>{text}</h1>
}
