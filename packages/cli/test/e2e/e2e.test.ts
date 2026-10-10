/**
 * Browser end-to-end: the spec's round-trip apps through the built `pwf`
 * binary, rendered in a real headless Chrome over CDP (see run-e2e.mjs).
 *
 * Skips, saying why, when there is no Chrome (set CHROME_PATH) or the CLI is
 * not built (`pnpm build`), so a machine without either stays green. Set
 * PWF_E2E_FOUNDATION to a real foundation pack folder to add the
 * `pwf create --foundation` scenario.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findChrome } from './cdp.mjs'

const DRIVER = fileURLToPath(new URL('./run-e2e.mjs', import.meta.url))
const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url))
const ROUNDTRIP = fileURLToPath(new URL('../../../../spec/roundtrip', import.meta.url))

const chrome = (findChrome as () => string | null)()
const reason = !chrome
  ? 'no Chrome found (set CHROME_PATH)'
  : !existsSync(BIN)
    ? 'the CLI is not built (run pnpm build)'
    : !existsSync(ROUNDTRIP)
      ? 'the spec is not beside the engine (spec/roundtrip is a separate repository upstream)'
      : undefined

interface ScenarioResult {
  readonly name: string
  readonly ok: boolean
  readonly assertions: { readonly passed: number; readonly failed: number }
  readonly timings: Record<string, number>
  readonly failures: readonly string[]
  readonly findings: readonly string[]
  /** Content Security Policy checks on the scenario's pages, and the violations counted. */
  readonly csp: { readonly checked: number; readonly violations: number }
}

describe.skipIf(reason !== undefined)('pwf in a real browser', () => {
  it('validates, builds, serves and renders L1, L2 and L3 under their CSP, and drives sign-in and data through the local host', async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [DRIVER], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (error, out, err) => {
        // Exit 1 still prints the summary; a crash prints none.
        if (error && !out.trim()) reject(new Error(err || error.message))
        else resolve(out)
      })
    })
    process.stdout.write(stdout)
    const summary = JSON.parse(stdout.trim().split('\n').pop() as string) as { skipped?: string; results?: ScenarioResult[] }
    if (summary.skipped) return
    const results = summary.results ?? []
    expect(results.map((r) => r.name.split(' ')[0])).toEqual(
      expect.arrayContaining(['l1-static', 'l2-custom-block', 'l3-data'])
    )
    for (const r of results) expect(r.failures, r.name).toEqual([])
  }, 660_000)
})

if (reason !== undefined) {
  describe('pwf in a real browser', () => {
    it.skip(`skipped: ${reason}`, () => undefined)
  })
}
