/**
 * Turns off zod's JIT in the browser bundle, before anything else runs.
 *
 * WHY. zod 4 compiles object parsers with `new Function` when it can, and
 * finds out whether it can by trying once. A pwapp's Content Security Policy
 * has no `'unsafe-eval'`, so that probe is refused — caught by zod, but still
 * reported as a `script-src` violation on every page. `jitless` makes zod
 * parse without generated code and never probe. Correctness is the same; the
 * JIT only speeds up very hot parse loops, which a rendered page does not have.
 *
 * This module is the FIRST import of `embed-global.ts`: ES modules evaluate
 * in import order, so the setting is in place before the runtime and the
 * contracts (bundled into the same file, sharing this zod) define or parse a
 * schema. `embed.js` seeds this same zod as `__pwfabric_zod` for the runner
 * and for compiled blocks, so the setting covers them too.
 */
import { config } from 'zod'

config({ jitless: true })
