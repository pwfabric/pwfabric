#!/usr/bin/env node
/**
 * Runs the spec's byte-level conformance fixtures through an implementation
 * and compares every verdict with the committed expected.json.
 *
 *   spec/fixtures/pwpack/<case>/            folder → readFolder → validate, hash, atoms
 *                                           and, when the adapter can, folder → archive → folder
 *   spec/fixtures/pwpack-archives/<case>    archive bytes → readArchive → (refused | validate, hash, atoms)
 *   spec/roundtrip/<app>/                   as a folder case, plus: archive round trip keeps the
 *                                           content hash; the foundation pin matches; one prop
 *                                           change in l1-static changes exactly one file
 *
 * Usage:
 *   node scripts/spec-conformance.mjs [--implementation <module>] [--quiet]
 *
 * Without `--implementation` it checks this repository's pack library
 * (`packages/pack/dist`, so build it first). With it, `<module>` is any ES
 * module whose default export (or the module itself) implements the adapter
 * documented in spec/fixtures/README.md: `{ readFolder, validate, hash,
 * atoms }` and, optionally, `readArchive` and `writeArchive`.
 *
 * Prints one row per check and exits 1 on any mismatch. The archive SHA-256
 * is informative (DEFLATE output may differ between zlib builds): it is
 * reported, never failed on.
 *
 * Node built-ins only.
 */
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = join(REPO, 'spec')

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** The reference adapter: this repository's pack library. */
async function referenceAdapter() {
  const entry = join(REPO, 'packages', 'pack', 'dist', 'index.js')
  let pack
  try {
    pack = await import(pathToFileURL(entry).href)
  } catch (err) {
    throw new Error(`cannot load the pack library at ${entry} — run "pnpm --filter @pwfabric/pack build" (${err?.message ?? err})`)
  }
  return {
    name: '@pwfabric/pack',
    readFolder: (dir) => pack.readFolder(dir),
    readArchive: (bytes) => pack.readPwpack(bytes),
    writeArchive: (folder) => pack.writePwpack(folder),
    validate: (folder) => {
      const v = pack.validatePack(folder)
      const of = (s) => v.issues.filter((i) => i.severity === s).map((i) => i.code)
      return { errors: of('error'), warnings: of('warning'), info: of('info') }
    },
    hash: (folder) => pack.hashPack(folder),
    atoms: (folder) => pack.deriveAtoms(folder),
  }
}

async function loadAdapter(spec) {
  if (!spec) return referenceAdapter()
  const mod = await import(pathToFileURL(resolve(process.cwd(), spec)).href)
  const adapter = mod.default ?? mod
  for (const fn of ['readFolder', 'validate', 'hash', 'atoms']) {
    if (typeof adapter[fn] !== 'function') throw new Error(`${spec}: the adapter has no ${fn}() (see spec/fixtures/README.md)`)
  }
  return { name: spec, ...adapter }
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
const codeSet = (list) => [...new Set(list ?? [])].sort(byteOrder)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const dirsIn = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

const atomList = (atoms) =>
  (atoms ?? []).map(({ kind, id }) => ({ kind, id })).sort((a, b) => byteOrder(a.kind, b.kind) || byteOrder(a.id, b.id))
const fmtCodes = (v) => [...v.errors.map((c) => `E:${c}`), ...v.warnings.map((c) => `W:${c}`), ...(v.info ?? []).map((c) => `I:${c}`)].join(' ') || '-'

/** The verdict an adapter gives for an opened pack, in expected.json terms. */
async function verdictOf(adapter, pack) {
  const v = await adapter.validate(pack)
  return {
    errors: codeSet(v.errors),
    warnings: codeSet(v.warnings),
    info: v.info === undefined ? undefined : codeSet(v.info),
    contentHash: await adapter.hash(pack),
    atoms: atomList(await adapter.atoms(pack)),
  }
}

/** Differences between an adapter verdict and expected.json, as short strings. */
function diff(expected, actual) {
  const out = []
  const valid = actual.errors.length === 0
  if (valid !== expected.valid) out.push(`valid ${valid} ≠ ${expected.valid}`)
  for (const key of ['errors', 'warnings']) {
    if (!same(actual[key], expected[key])) out.push(`${key} [${actual[key]}] ≠ [${expected[key]}]`)
  }
  if (actual.info !== undefined && !same(actual.info, expected.info)) out.push(`info [${actual.info}] ≠ [${expected.info}]`)
  if (actual.contentHash !== expected.contentHash) out.push(`contentHash ${actual.contentHash} ≠ ${expected.contentHash}`)
  if (!same(actual.atoms, expected.atoms)) out.push(`atoms differ (${actual.atoms.length} vs ${expected.atoms.length})`)
  return out
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const rows = []
const record = (group, name, expected, actual, problems, note = '') =>
  rows.push({ group, name, expected, actual, ok: problems.length === 0, problems, note })

/** Folder → archive → folder keeps the content hash. Returns [problems, note]. */
async function archiveRoundTrip(adapter, pack, expected) {
  if (!adapter.writeArchive || !adapter.readArchive) return [[], 'no archive writer']
  const bytes = await adapter.writeArchive(pack)
  const back = await adapter.readArchive(bytes)
  const hash = await adapter.hash(back)
  const problems = hash === expected.contentHash ? [] : [`archive round trip ${hash} ≠ ${expected.contentHash}`]
  const archiveSha = `sha256:${sha256Hex(bytes)}`
  const note = expected.archiveSha256 == null ? '' : archiveSha === expected.archiveSha256 ? 'archive = reference' : 'archive ≠ reference (informative)'
  return [problems, note]
}

async function folderCase(adapter, group, name, dir, extra = async () => []) {
  const expected = readJson(join(dir, 'expected.json'))
  const want = fmtCodes(expected) + (expected.valid ? ' (valid)' : ' (invalid)')
  let pack
  try {
    pack = await adapter.readFolder(join(dir, 'input'))
  } catch (err) {
    record(group, name, want, `threw ${err?.code ?? err?.message}`, ['readFolder threw'])
    return null
  }
  const actual = await verdictOf(adapter, pack)
  const problems = diff(expected, actual)
  const [rt, note] = problems.length === 0 ? await archiveRoundTrip(adapter, pack, expected) : [[], '']
  problems.push(...rt, ...(await extra(pack, expected)))
  record(group, name, want, fmtCodes(actual) + (actual.errors.length === 0 ? ' (valid)' : ' (invalid)'), problems, note)
  return pack
}

async function archiveCase(adapter, name) {
  const expected = readJson(join(SPEC, 'fixtures', 'pwpack-archives', `${name}.expected.json`))
  const bytes = Buffer.from(readFileSync(join(SPEC, 'fixtures', 'pwpack-archives', `${name}.pwpack.b64`), 'utf8').replace(/\s+/g, ''), 'base64')
  const want = expected.stage === 'read' ? `refuse ${expected.errors[0]}` : `open; ${fmtCodes(expected)}`
  if (`sha256:${sha256Hex(bytes)}` !== expected.archiveSha256) {
    record('archive', name, want, 'fixture corrupt', ['the .b64 does not decode to archiveSha256'])
    return
  }
  let pack
  try {
    pack = await adapter.readArchive(new Uint8Array(bytes))
  } catch (err) {
    const code = err?.code ?? 'no code'
    const problems = expected.stage === 'read' && code === expected.errors[0] ? [] : [`refused with ${code}${err?.code ? '' : `: ${err?.message}`}`]
    record('archive', name, want, `refuse ${code}`, problems, expected.limits ? 'limit' : '')
    return
  }
  if (expected.stage === 'read') {
    record('archive', name, want, 'opened', [`expected refusal ${expected.errors[0]}`])
    return
  }
  const actual = await verdictOf(adapter, pack)
  record('archive', name, want, `open; ${fmtCodes(actual)}`, diff(expected, actual))
}

/** Change one prop in a copy of l1-static: exactly one file and the hash must change. */
async function onePropChange(adapter) {
  const src = join(SPEC, 'roundtrip', 'l1-static', 'input')
  const tmp = mkdtempSync(join(tmpdir(), 'pwf-conformance-'))
  try {
    cpSync(src, tmp, { recursive: true })
    const receipt = join(tmp, 'app', 'surfaces', 'home.receipt.json')
    const doc = JSON.parse(readFileSync(receipt, 'utf8'))
    doc.blocks[0].children[0].props.content = 'A changed headline.'
    writeFileSync(receipt, JSON.stringify(doc, null, 2) + '\n')
    const before = await adapter.readFolder(src)
    const after = await adapter.readFolder(tmp)
    const problems = []
    if ((await adapter.hash(before)) === (await adapter.hash(after))) problems.push('content hash did not change')
    // Which files differ: compare per-file content hashes with the spec rule, from disk.
    const files = (dir, rel = '') =>
      readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]
      )
    const digest = (dir) => new Map(files(dir).map((p) => [p, sha256Hex(readFileSync(join(dir, p)))]))
    const a = digest(src)
    const b = digest(tmp)
    const changed = [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p))
    if (!same(changed, ['app/surfaces/home.receipt.json'])) problems.push(`changed files: ${changed.join(', ')}`)
    record('roundtrip', 'l1-static one prop', '1 file, new hash', `${changed.length} file, ${problems.length ? 'see problems' : 'new hash'}`, problems)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--implementation')
  const adapter = await loadAdapter(i === -1 ? undefined : args[i + 1])
  const quiet = args.includes('--quiet')

  for (const name of dirsIn(join(SPEC, 'fixtures', 'pwpack'))) {
    await folderCase(adapter, 'folder', name, join(SPEC, 'fixtures', 'pwpack', name))
  }

  if (adapter.readArchive) {
    const names = readdirSync(join(SPEC, 'fixtures', 'pwpack-archives'))
      .filter((f) => f.endsWith('.pwpack.b64'))
      .map((f) => f.slice(0, -'.pwpack.b64'.length))
      .sort()
    for (const name of names) await archiveCase(adapter, name)
  } else {
    record('archive', '(all)', '-', 'skipped', [], 'adapter has no readArchive')
  }

  const foundation = readJson(join(SPEC, 'roundtrip', '_foundation', 'expected.json'))
  for (const name of dirsIn(join(SPEC, 'roundtrip'))) {
    await folderCase(adapter, 'roundtrip', name, join(SPEC, 'roundtrip', name), async (_pack, expected) => {
      if (name === '_foundation') return []
      const identity = readJson(join(SPEC, 'roundtrip', name, 'input', 'pwpack.json'))
      const pin = (identity.packs ?? []).find((p) => p.id === expected.pins?.[0]?.id)
      return pin?.hash === foundation.contentHash ? [] : [`foundation pin ${pin?.hash} ≠ ${foundation.contentHash}`]
    })
  }
  await onePropChange(adapter)

  // ---- report ----
  const w = { group: 9, name: 30, expected: 44, actual: 44 }
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))
  const failed = rows.filter((r) => !r.ok)
  console.log(`spec conformance — implementation: ${adapter.name}`)
  console.log(`${'group'.padEnd(w.group)} ${'case'.padEnd(w.name)} ${'expected'.padEnd(w.expected)} ${'actual'.padEnd(w.actual)} result`)
  console.log('-'.repeat(w.group + w.name + w.expected + w.actual + 12))
  for (const r of quiet ? failed : rows) {
    console.log(`${cut(r.group, w.group)} ${cut(r.name, w.name)} ${cut(r.expected, w.expected)} ${cut(r.actual, w.actual)} ${r.ok ? 'ok' : 'FAIL'}${r.note ? `  (${r.note})` : ''}`)
  }
  for (const r of failed) console.log(`\nFAIL ${r.group}/${r.name}\n  ${r.problems.join('\n  ')}`)
  console.log(`\n${rows.length - failed.length}/${rows.length} ok${failed.length ? `, ${failed.length} FAILED` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch((err) => {
  console.error(`spec-conformance: ${err?.stack ?? err}`)
  process.exitCode = 2
})
