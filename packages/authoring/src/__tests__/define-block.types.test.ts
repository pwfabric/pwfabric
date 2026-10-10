/**
 * defineBlock() infers a block's props from its SCHEMA.
 *
 * The props used to be inferred from `defaultProps` too, and TypeScript took
 * the narrower candidate: a schema field declared `.optional()` but given a
 * default value came out as `string`, not `string | undefined`, and the
 * documented quick-start block failed strict type-checking. This test
 * type-checks that block with the strict settings a consumer project uses.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'define-block.ts').split('\\').join('/')
// Inside the package, so `zod` resolves from its node_modules as in a consumer.
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

describe('defineBlock() infers props from the schema', () => {
  it('accepts the quick-start block: an optional field with a default value', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'
      import { z } from 'zod'

      export const CustomerQuote = defineBlock({
        type: 'customer-quote',
        name: 'Customer quote',
        category: 'text',
        schema: z.object({
          quote: z.string().min(10).max(500),
          author: z.string(),
          role: z.string().optional(),
        }),
        defaultProps: { quote: 'A great product to work with.', author: 'Jane Doe', role: 'Product Manager' },
        component: ({ props }) => {
          const role: string | undefined = props.role
          return role ?? props.author
        },
      })
    `)
    expect(errors).toEqual([])
  })

  it('still refuses default props that do not fit the schema', () => {
    const errors = diagnostics(`
      import { defineBlock } from '${SRC}'
      import { z } from 'zod'

      export const Price = defineBlock({
        type: 'price-tag',
        name: 'Price tag',
        schema: z.object({ amount: z.number() }),
        defaultProps: { amount: 'twelve' },
        component: () => null,
      })
    `)
    expect(errors.length).toBeGreaterThan(0)
  })
})
