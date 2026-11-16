/**
 * @vitest-environment node
 *
 * `embed.js` must make zod jitless before any module it bundles defines a
 * schema. zod 4 probes `new Function` when an object schema is created; under
 * a pwapp's CSP that probe is reported as a `script-src` violation on every
 * page (the CLI's browser e2e counts them, but it only runs where Chrome and
 * the spec are present).
 *
 * ES modules load in the order the file names them, and an `export … from`
 * loads its module just as an `import` does. So the setting holds only while
 * `./zod-jitless.js` is the FIRST module `embed-global.ts` names.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { config } from 'zod'

const SOURCE = fileURLToPath(new URL('../embed-global.ts', import.meta.url))

describe('zod is jitless before anything in embed.js uses it', () => {
  it('./zod-jitless.js is the first module embed-global.ts loads', () => {
    // The first statement that names a module: any line starting with
    // `import` or `export` (the file's comments do not start that way).
    const first = readFileSync(SOURCE, 'utf8')
      .split('\n')
      .find((line) => /^(import|export)\b/.test(line))
    expect(first).toBe(`import './zod-jitless.js'`)
  })

  it('loading it turns zod’s JIT off', async () => {
    await import('../zod-jitless.js')
    expect(config().jitless).toBe(true)
  })
})
