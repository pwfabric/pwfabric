# Surface Rendering System

The Surface rendering system enables declarative UI composition using PWFabric blocks.

## Overview

The renderer converts block definitions into React components, from built-in block types and custom surfaces.

## Components

### BlockSurfaceRenderer

Main component for rendering surfaces:

```tsx
import { BlockSurfaceRenderer } from '@pwfabric/runtime'
import { MyCustomSurface } from './surfaces'

function MyPage() {
  return <BlockSurfaceRenderer surface={MyCustomSurface} theme="light" basePath="/" />
}
```

### Props

| Prop        | Type                | Required | Description                          |
| ----------- | ------------------- | -------- | ------------------------------------ |
| `surface`   | `RenderableSurface` | Yes      | Surface definition with blocks array |
| `theme`     | `'light' \| 'dark'` | No       | Theme mode (default: 'light')        |
| `basePath`  | `string`            | No       | Base path for links (default: '/')   |
| `className` | `string`            | No       | Additional CSS classes               |

## Supported Block Types

- `container` - Layout container
- `grid` - Grid layout
- `text` - Text content
- `heading` - Headings (h1-h6)
- `button` - Interactive buttons
- `image` - Images
- `link` - Navigation links
- `icon` - Icons
- `list` - Lists
- `table` - Tables
- `badge` - Badges
- `code` - Code blocks
- `divider` - Dividers
- `form` - Forms
- `input` - Form inputs

## Creating Custom Surfaces

```tsx
import type { RenderableSurface } from '@pwfabric/runtime'

const MySurface: RenderableSurface = {
  blocks: [
    {
      type: 'container',
      props: { className: 'my-section' },
      children: [
        {
          type: 'heading',
          props: { level: 1, content: 'Hello World' },
        },
        {
          type: 'text',
          props: { content: 'Welcome to my surface' },
        },
      ],
    },
  ],
}
```

## Performance

- All blocks are rendered as native React components
- Supports static generation (SSG)
- Minimal bundle overhead (~34 KB)
- Tree-shaking removes unused block components

## Testing

```tsx
import { render, screen } from '@testing-library/react'
import { BlockSurfaceRenderer } from '@pwfabric/runtime'

test('renders surface', () => {
  render(<BlockSurfaceRenderer surface={mySurface} />)
  expect(screen.getByRole('heading')).toBeInTheDocument()
})
```
