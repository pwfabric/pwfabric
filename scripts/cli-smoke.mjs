#!/usr/bin/env node
/**
 * CLI smoke: the `pwf` binary, end to end, on whatever OS runs it.
 *
 *   pwf create smoke --dir <tmp> --foundation spec/roundtrip/_foundation/input
 *   pwf validate <tmp>
 *   pwf pack <tmp> --out <tmp>/a.pwpack     (twice: a and b)
 *   pwf build <tmp>
 *
 * Every step must exit 0, and the two packs must agree: the printed content
 * hash (the hash pins use) and the archive bytes. The content hash is what CI
 * compares across operating systems; the archive SHA-256 is reported too but
 * only compared within one run (DEFLATE output may differ between zlib builds).
 *
 * Usage: node scripts/cli-smoke.mjs [--keep]
 *
 * Needs `packages/cli/dist` built (`pnpm -r --filter "@pwfabric/cli..." build`).
 * In GitHub Actions it appends `hash=` and `archive=` to $GITHUB_OUTPUT and a
 * row to $GITHUB_STEP_SUMMARY. Node built-ins only.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(REPO, 'packages', 'cli', 'dist', 'bin.js')
const FOUNDATION = join(REPO, 'spec', 'roundtrip', '_foundation', 'input')
const keep = process.argv.includes('--keep')

const work = mkdtempSync(join(tmpdir(), 'pwf-smoke-'))
const app = join(work, 'smoke')

function pwf(...args) {
  console.log(`$ pwf ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: work, encoding: 'utf8' })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) {
    throw new Error(`pwf ${args[0]} exited ${r.status ?? r.signal}`)
  }
  return r.stdout
}

/** The content hash `pwf pack` prints on its `hash` line. */
function packedHash(stdout) {
  const m = /^\s*hash\s+(\S+)\s*$/m.exec(stdout)
  if (!m) throw new Error('pwf pack printed no hash line')
  return m[1]
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

let code = 0
try {
  pwf('create', 'smoke', '--dir', app, '--foundation', FOUNDATION)
  pwf('validate', app)
  const a = join(work, 'a.pwpack')
  const b = join(work, 'b.pwpack')
  const hashA = packedHash(pwf('pack', app, '--out', a))
  const hashB = packedHash(pwf('pack', app, '--out', b))
  const shaA = sha256(a)
  const shaB = sha256(b)
  pwf('build', app)

  console.log(`\ncontent hash  ${hashA} / ${hashB}`)
  console.log(`archive sha   ${shaA} / ${shaB}`)
  if (hashA !== hashB) throw new Error('pack twice gave two content hashes')
  if (shaA !== shaB) throw new Error('pack twice gave two different archives')

  if (process.env.GITHUB_OUTPUT) {
    // Per-OS names too: the legs of a matrix job share one set of job
    // outputs, and only distinct names survive side by side for the job
    // that compares them.
    const os = process.env.RUNNER_OS ?? platform()
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `hash=${hashA}\narchive=${shaA}\nhash_${os}=${hashA}\narchive_${os}=${shaA}\n`
    )
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### pwf smoke on ${process.env.RUNNER_OS ?? platform()}\n\n` +
        `| | value |\n|---|---|\n| content hash | \`${hashA}\` |\n| archive SHA-256 | \`${shaA}\` |\n`
    )
  }
  console.log('\ncli smoke: ok')
} catch (err) {
  console.error(`\ncli smoke: FAILED — ${err.message}`)
  code = 1
} finally {
  if (keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
process.exitCode = code
