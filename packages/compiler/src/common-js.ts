/**
 * A compiled atom module as a CommonJS body.
 *
 * The build's static first paint (pwapp-format §2.5) renders pages outside a
 * browser, in an isolated context that has no import map and no module
 * loader. There a compiled block is evaluated as a function body: its host
 * imports (`react`, `@pwfabric/runtime`, …) become `require(...)` calls the
 * host answers with the instances it seeded, exactly as the browser's import
 * map answers them with the shims. The module's code is otherwise the one
 * the browser runs.
 *
 * @module @pwfabric/compiler/common-js
 */
import { transform } from 'esbuild'

/** `code` (an ES module) as a CommonJS body reading `require`, `module` and `exports`. */
export async function toCommonJs(code: string): Promise<string> {
  const out = await transform(code, { format: 'cjs', loader: 'js', target: 'es2022', logLevel: 'silent' })
  return out.code
}
