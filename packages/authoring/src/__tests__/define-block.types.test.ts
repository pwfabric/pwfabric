/**
 * defineBlock() types a block's props from its explicit `TProps` generic.
 *
 * There is no schema to infer from (3.0): the author writes the TypeScript
 * view of the props (`defineBlock<MyProps>(...)`), the component's `props` is
 * `TProps`, and `defaultProps` is `Partial<TProps>`. The declared descriptors
 * (`props`) are typed `BlockPropDescriptor[]`. These tests type-check fixture
 * blocks with the strict settings a consumer project uses.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'define-block.ts').split('\\').join('/')
// Inside the package, so `@pwfabric/contracts` resolves from its node_modules as in a consumer.
const PKG = join(HERE, '..', '..')

function diagnostics(source: string): string[] {
  const dir = mkdtempSync(join(PKG, '.type-fixture-'))
  try {
    const file = join(dir, 'block.ts')
    writeFileSync(file, source)
    const program = ts.createProgram([file], {
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    })
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === file.split('\\').join('/') || d.file?.fileName === file)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Each test runs the TypeScript compiler over a fixture; under a parallel
// coverage run that takes longer than the 5 s default.
describe('defineBlock() types props from its TProps generic', { timeout: 30_000 }, () => {
  it('accepts the quick-start block: an optional field with a default value', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'

      interface CustomerQuoteProps extends Record<string, unknown> {
        readonly quote: string
        readonly author: string
        readonly role?: string
      }

      export const CustomerQuote = defineBlock<CustomerQuoteProps>({
        type: 'customer-quote',
        name: 'Customer quote',
        category: 'text',
        props: [
          { name: 'quote', required: true, jsonSchema: { type: 'string', minLength: 10, maxLength: 500 }, copy: true },
          { name: 'author', required: true, jsonSchema: { type: 'string' }, copy: true },
          { name: 'role', jsonSchema: { type: 'string' }, copy: true },
        ],
        defaultProps: { quote: 'A great product to work with.', author: 'Jane Doe', role: 'Product Manager' },
        component: ({ props }) => {
          const role: string | undefined = props.role
          const author: string = props.author
          return role ?? author
        },
      })
    `)
    expect(errors).toEqual([])
  })

  it('types defaultProps as Partial<TProps>: required fields may be left out', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'

      type PriceProps = { amount: number; currency: string }

      export const Price = defineBlock<PriceProps>({
        type: 'price-tag',
        name: 'Price tag',
        defaultProps: { currency: 'EUR' },
        component: ({ props }) => props.currency + String(props.amount),
      })
    `)
    expect(errors).toEqual([])
  })

  it('still refuses default props that do not fit TProps', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'

      type PriceProps = { amount: number }

      export const Price = defineBlock<PriceProps>({
        type: 'price-tag',
        name: 'Price tag',
        props: [{ name: 'amount', jsonSchema: { type: 'number' } }],
        defaultProps: { amount: 'twelve' },
        component: () => null,
      })
    `)
    expect(errors.join(' | ')).toMatch(/'string' is not assignable to type 'number'/)
  })

  it('refuses a component that reads a prop TProps does not have', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'

      type PriceProps = { amount: number }

      export const Price = defineBlock<PriceProps>({
        type: 'price-tag',
        name: 'Price tag',
        component: ({ props }) => props.missing,
      })
    `)
    expect(errors.join(' | ')).toMatch(/Property 'missing' does not exist/)
  })

  it('refuses a prop descriptor whose shape is not a PropShape', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'

      export const Bad = defineBlock({
        type: 'bad-shape',
        name: 'Bad shape',
        props: [{ name: 'size', jsonSchema: { type: 'text' } }],
        component: () => null,
      })
    `)
    expect(errors.join(' | ')).toMatch(/'"text"' is not assignable/)
  })

  it('types the definition: props is a descriptor array, component props are TProps', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'
      import type { BlockPropDescriptor } from '@pwfabric/contracts'

      type HeroProps = { headline: string }

      const Hero = defineBlock<HeroProps>({
        type: 'hero-banner',
        name: 'Hero',
        props: [{ name: 'headline', default: 'Hello', jsonSchema: { type: 'string' } }],
        component: ({ props }) => props.headline,
      })

      export const descriptors: readonly BlockPropDescriptor[] = Hero.props
      export const start: Partial<HeroProps> = Hero.defaultProps
      // @ts-expect-error -- the zod schema is gone from the definition
      export const schema = Hero.schema
    `)
    expect(errors).toEqual([])
  })
})
