/**
 * `next build`, once more when it fails the way Windows makes it fail: Next
 * moves its own export files (`.next/export/500.html` to
 * `.next/server/pages/`) with a rename, and on Windows a scanner or indexer
 * holding a file for a moment fails that rename with ENOENT/EPERM/EBUSY. The
 * rename is Next's, not this site's, so the build is run again from a clean
 * `.next` — once, and only for that failure; any other failure stands.
 */
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('..', import.meta.url))
const RENAME_RACE = /\b(?:ENOENT|EPERM|EBUSY)\b[^\n]*\brename\b[^\n]*[\\/]\.next[\\/]/

function nextBuild() {
  return new Promise((resolve) => {
    const child = spawn('next', ['build'], { cwd: site, shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => {
      output += d
      process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      output += d
      process.stderr.write(d)
    })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

let result = await nextBuild()
if (result.code !== 0 && process.platform === 'win32' && RENAME_RACE.test(result.output)) {
  console.warn('next-build: Next could not move one of its own files (a Windows file lock); building once more from a clean .next')
  await rm(new URL('../.next', import.meta.url), { recursive: true, force: true, maxRetries: 5 })
  result = await nextBuild()
}
process.exit(result.code)
