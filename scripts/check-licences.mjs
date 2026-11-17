#!/usr/bin/env node
/**
 * Every BSL-licensed package names its own version in its LICENSE.
 *
 * The Business Source License parameters are per version: "Licensed Work"
 * names the version and "Change Date" is when that version becomes Apache-2.0
 * (four years after it is first published, LICENCE.md). A LICENSE left at an
 * old version ships with every later release, which is how 2.0.0 went out
 * still saying 1.0.0. This check fails while any BSL package's LICENSE names a
 * version other than the one in its package.json, or a Change Date that is
 * not a valid date at least four years after today's release.
 *
 * Usage: node scripts/check-licences.mjs [--release YYYY-MM-DD]
 *   --release  the publication date to check the Change Date against
 *              (the release workflow passes the tag's date); without it,
 *              only the version and the date's shape are checked
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = process.argv.indexOf('--release')
const release = at > 0 ? process.argv[at + 1] : undefined
const problems = []

for (const dir of readdirSync(join(ROOT, 'packages'))) {
  const licence = join(ROOT, 'packages', dir, 'LICENSE')
  if (!existsSync(licence)) continue
  const text = readFileSync(licence, 'utf8')
  if (!text.startsWith('Business Source License')) continue
  const { name, version } = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'))
  const work = /Licensed Work:\s+(\S+)\s+(\S+)/.exec(text)
  const change = /Change Date:\s+(\d{4}-\d{2}-\d{2})/.exec(text)
  if (!work || work[1] !== name || work[2] !== version) {
    problems.push(`${dir}/LICENSE names "${work ? `${work[1]} ${work[2]}` : '?'}", package.json is ${name} ${version}`)
  }
  if (!change || Number.isNaN(Date.parse(change[1]))) {
    problems.push(`${dir}/LICENSE has no valid Change Date`)
  } else if (release) {
    const due = new Date(release)
    due.setUTCFullYear(due.getUTCFullYear() + 4)
    if (change[1] !== due.toISOString().slice(0, 10)) {
      problems.push(`${dir}/LICENSE Change Date is ${change[1]}; four years after ${release} is ${due.toISOString().slice(0, 10)}`)
    }
  }
}

if (problems.length) {
  console.error('check-licences:')
  for (const p of problems) console.error('  x ' + p)
  process.exit(1)
}
console.log('check-licences: every BSL LICENSE names its package version')
