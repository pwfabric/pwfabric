# @pwfabric/authoring

What you write a pwpack with: `defineBlock()`, `defineFactory()` and
`defineCapability()`, plus the block registry and prop validation. A block's
props are declared once, as data (its manifest's `definition.props`), and
typed by an interface you write; no validation library is involved. It
re-exports `@pwfabric/runtime`.

## Install

```bash
pnpm add @pwfabric/authoring @pwfabric/runtime @pwfabric/contracts react react-dom
pnpm add -D typescript @types/react
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. Peer: `react` 19.
`zod` 4 is used only by `defineFactory()`'s optional `configSchema`.

```tsx
import { defineBlock } from '@pwfabric/authoring'

interface QuoteProps extends Record<string, unknown> {
  readonly quote: string
  readonly author: string
}

export const Quote = defineBlock<QuoteProps>({
  type: 'customer-quote',
  name: 'Customer quote',
  props: [
    { name: 'quote', required: true, jsonSchema: { type: 'string' }, copy: true },
    { name: 'author', required: true, jsonSchema: { type: 'string' }, copy: true },
  ],
  defaultProps: { quote: 'A great product to work with.', author: 'Jane Doe' },
  component: ({ props }) => <blockquote>{props.quote} — {props.author}</blockquote>,
})
```

## Main exports

| Export | What it is |
|--------|------------|
| `defineBlock`, `validateBlockDefinition`, `createBlockInstance`, `isCustomBlockDefinition` | Blocks — see [defineBlock()](https://pwfabric.com/authoring/define-block) |
| `defineFactory`, `composeFactoryOutputs`, `wrapInContainer` | Factories — see [defineFactory()](https://pwfabric.com/authoring/define-factory) |
| `defineCapability`, `CapabilityBuilder` | Capabilities — see [defineCapability()](https://pwfabric.com/authoring/define-capability) |
| `CustomBlockRegistry`, `createCustomBlockRegistry`, `mergeRegistries` | Block registries |
| `validateProps`, `validateBlock`, `validateBlockTree`, `formatValidationErrors` | Validation |
| `CustomBlockOptions`, `CustomBlockDefinition`, `InferBlockProps`, … | Types (`BlockPropDescriptor` and `PropShape` come from `@pwfabric/contracts`) |
| everything from `@pwfabric/runtime` | Re-exported |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/authoring` | Everything above (the only entry point) |

## Licence

Apache-2.0 — see `LICENSE`. No additional conditions, patent grant included. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
