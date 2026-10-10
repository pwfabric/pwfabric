# @pwfabric/authoring

What you write a pwpack with: `defineBlock()`, `defineFactory()` and
`defineCapability()`, plus the block registry and prop validation. A block's
props are inferred from its zod schema. It re-exports `@pwfabric/runtime`.

## Install

```bash
pnpm add @pwfabric/authoring@rc @pwfabric/runtime@rc @pwfabric/contracts@rc zod@3 react react-dom
pnpm add -D typescript @types/react
```

ESM only: import it from an ES module (`"type": "module"` or `.mjs`). Node 22+. Peer: `react` 19.

```tsx
import { defineBlock } from '@pwfabric/authoring'
import { z } from 'zod'

export const Quote = defineBlock({
  type: 'customer-quote',
  name: 'Customer quote',
  schema: z.object({ quote: z.string(), author: z.string() }),
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
| `CustomBlockOptions`, `SchemaProps`, `CustomBlockDefinition`, `InferBlockProps`, … | Types |
| everything from `@pwfabric/runtime` | Re-exported |

## Entry points

| Import | Contents |
|--------|----------|
| `@pwfabric/authoring` | Everything above (the only entry point) |

## Licence

Apache-2.0 — see `LICENSE`. No additional conditions, patent grant included. See [licensing](https://pwfabric.com/licence).

Part of [PWFabric](https://pwfabric.com) — the engine that renders an app. Source: [github.com/pwfabric/pwfabric](https://github.com/pwfabric/pwfabric).
