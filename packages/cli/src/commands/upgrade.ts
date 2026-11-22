/**
 * `pwf upgrade [--check] [--from <pack build>]... [--to <id>@<version>]` —
 * moves the app's pinned packs to newer builds it is given.
 *
 * pwf keeps no registry of pack versions: the newer builds are the ones
 * `--from` names (a `.pwpack`, a pack folder, or a folder holding several).
 * For each pinned pack with a newer build there, it reports whether the
 * build's `engines.pwfabric` admits this engine, whether its major changed,
 * the blocks and props the newer build no longer has (by comparing the two
 * builds' manifests) and where the app's receipts still use them, and the
 * build's CHANGELOG between the two versions when it carries one. Without
 * `--check` it re-pins each to the newest build this engine can run (or the
 * one `--to` names), exactly as `pwf add` installs a build.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { validatePack, type PackFolder } from '@pwfabric/pack'
import { satisfiesSemverRange } from '@pwfabric/contracts/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, stringFlags, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { cacheDir, readCachedPack, readPackSource, resolveFrom } from './lib/project.js'
import { engineVersion, pinsOf, readIdentityFile, type PackPin } from './lib/identity.js'
import { addPack } from './add.js'
import { isObject, receiptRel, surfaceOrderOf, readJsonObject } from './lib/app-files.js'

/** `[major, minor, patch, prerelease]` of a semver version, or undefined. */
function parseVersion(v: string): [number, number, number, string] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''] : undefined
}

/** Semver order of two versions (a prerelease before its release); NaN when either is not one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return NaN
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)
  if (x[3] === y[3]) return 0
  if (!x[3]) return 1
  if (!y[3]) return -1
  return x[3] < y[3] ? -1 : 1
}

const releaseOf = (version: string): string => version.replace(/-.*$/, '')

/** A block's props from its manifest: `definition.props[].name`. */
function blockProps(pack: PackFolder): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [path, bytes] of pack.files) {
    const m = /^(?:atoms\/)?blocks\/(.+)\/manifest\.json$/.exec(path)
    if (!m) continue
    let doc: unknown
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      continue
    }
    const id = isObject(doc) && typeof doc['id'] === 'string' ? doc['id'] : (m[1] as string).replace(/\//g, '.')
    const def = isObject(doc) && isObject(doc['definition']) ? doc['definition'] : {}
    const props = Array.isArray(def['props']) ? def['props'].filter(isObject).map((p) => p['name']).filter((n): n is string => typeof n === 'string') : []
    out.set(id, new Set(props))
  }
  return out
}

/** Patterns a pack ships, by name. */
function patternNames(pack: PackFolder): Set<string> {
  return new Set([...pack.files.keys()].map((p) => /^(?:atoms\/)?patterns\/([^/]+)\.json$/.exec(p)?.[1]).filter((n): n is string => !!n))
}

/** The sections of a CHANGELOG.md for versions after `from` up to `to`. */
export function changelogBetween(text: string, from: string, to: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let keep = false
  for (const line of lines) {
    const head = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/.exec(line)
    if (head) keep = compareVersions(head[1] as string, from) > 0 && compareVersions(head[1] as string, to) <= 0
    else if (/^##\s/.test(line)) keep = false
    if (keep) out.push(line)
  }
  while (out.length > 0 && out[out.length - 1]?.trim() === '') out.pop()
  return out
}

/** Where the app's receipts use a block type (by its id or its last name) with a prop. */
async function usesOf(root: string, keys: readonly string[], blockId: string, prop?: string): Promise<string[]> {
  const short = blockId.split('.').pop()
  const hits: string[] = []
  for (const key of keys) {
    const receipt = await readJsonObject(root, receiptRel(key)).catch(() => undefined)
    const walk = (nodes: unknown): void => {
      for (const n of Array.isArray(nodes) ? nodes : []) {
        if (!isObject(n)) continue
        if ((n['type'] === blockId || n['type'] === short) && (prop === undefined || (isObject(n['props']) && prop in n['props']))) {
          hits.push(`${key}#${String(n['id'] ?? '?')}`)
        }
        walk(n['children'])
      }
    }
    walk(receipt?.['blocks'])
  }
  return hits
}

export interface Candidate {
  readonly version: string
  /** The `.pwpack` or folder it was read from (absolute). */
  readonly source: string
  readonly engines?: string
  readonly runsOnThisEngine: boolean
  readonly major: boolean
  readonly removedBlocks: readonly string[]
  readonly removedProps: readonly { readonly block: string; readonly prop: string; readonly usedAt: readonly string[] }[]
  readonly removedPatterns: readonly string[]
  readonly usedRemovedBlocks: readonly string[]
  readonly changelog: readonly string[]
}

export interface PackUpgrade {
  readonly id: string
  readonly pinned: string
  /** The cached build of the pinned version was there to compare with. */
  readonly compared: boolean
  readonly candidates: readonly Candidate[]
  /** The version pwf re-pins to (or would, under --check); none when no candidate fits. */
  readonly chosen?: string
  readonly repinned?: boolean
  readonly note?: string
}

/** Every pack build under the `--from` paths: a `.pwpack` / `.tgz`, a pack folder, or a folder of either. */
async function sourcesOf(paths: readonly string[]): Promise<{ path: string; pack: PackFolder; id: string; version: string; engines?: string }[]> {
  const out: { path: string; pack: PackFolder; id: string; version: string; engines?: string }[] = []
  const read = async (path: string): Promise<boolean> => {
    const pack = await readPackSource(path).catch(() => null)
    const identity = pack ? validatePack(pack).identity : undefined
    if (!pack || !identity) return false
    out.push({ path, pack, id: identity.id, version: identity.version, ...(identity.engines?.pwfabric ? { engines: identity.engines.pwfabric } : {}) })
    return true
  }
  for (const p of paths) {
    const st = await stat(p).catch(() => null)
    if (!st) throw new UsageError(`--from ${p}: no such file or folder`)
    if (st.isFile() || (await stat(join(p, 'pwpack.json')).catch(() => null))) {
      if (!(await read(p))) throw new CommandFailure('PACK_INVALID', `${p} is not a readable pack build`)
      continue
    }
    for (const name of await readdir(p)) {
      const child = join(p, name)
      const cst = await stat(child)
      if (cst.isDirectory() ? await stat(join(child, 'pwpack.json')).catch(() => null) : /\.(?:pwpack|tgz)$/.test(name)) await read(child)
    }
  }
  return out
}

export interface UpgradeOptions {
  readonly from: readonly string[]
  readonly check: boolean
  readonly to?: { readonly id: string; readonly version: string }
  readonly engine?: string
}

export async function upgradePacks(root: string, options: UpgradeOptions): Promise<PackUpgrade[]> {
  const identity = await readIdentityFile(root)
  const pins = pinsOf(identity as { packs?: PackPin[] })
  if (options.to && !pins.some((p) => p.id === options.to?.id)) throw new UsageError(`--to ${options.to.id}: the app pins no such pack`)
  const engine = options.engine ?? engineVersion()
  const builds = await sourcesOf(options.from)
  const app = isObject(identity['app']) ? identity['app'] : {}
  const keys = [...surfaceOrderOf(app), ...['notFound', 'signIn'].map((k) => app[k]).filter((k): k is string => typeof k === 'string')]
  const results: PackUpgrade[] = []
  for (const pin of pins) {
    if (options.to && options.to.id !== pin.id) continue
    let pinned: PackFolder | undefined
    try {
      pinned = await readCachedPack(cacheDir(root, pin.id, pin.version))
    } catch {
      pinned = undefined
    }
    const oldBlocks = pinned ? blockProps(pinned) : new Map<string, Set<string>>()
    const oldPatterns = pinned ? patternNames(pinned) : new Set<string>()
    const newer = builds.filter((b) => b.id === pin.id && compareVersions(b.version, pin.version) > 0).sort((a, b) => compareVersions(b.version, a.version))
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (const b of newer) {
      if (seen.has(b.version)) continue
      seen.add(b.version)
      const blocks = blockProps(b.pack)
      const removedBlocks = [...oldBlocks.keys()].filter((id) => !blocks.has(id))
      const removedProps: Candidate['removedProps'][number][] = []
      for (const [id, props] of oldBlocks) {
        const now = blocks.get(id)
        if (!now) continue
        for (const prop of props) if (!now.has(prop)) removedProps.push({ block: id, prop, usedAt: await usesOf(root, keys, id, prop) })
      }
      const usedRemovedBlocks: string[] = []
      for (const id of removedBlocks) usedRemovedBlocks.push(...(await usesOf(root, keys, id)))
      const patterns = patternNames(b.pack)
      const log = b.pack.files.get('CHANGELOG.md')
      candidates.push({
        version: b.version,
        source: b.path,
        ...(b.engines ? { engines: b.engines } : {}),
        runsOnThisEngine: !b.engines || satisfiesSemverRange(releaseOf(engine), b.engines),
        major: parseVersion(b.version)?.[0] !== parseVersion(pin.version)?.[0],
        removedBlocks,
        removedProps,
        removedPatterns: [...oldPatterns].filter((n) => !patterns.has(n)),
        usedRemovedBlocks,
        changelog: log ? changelogBetween(new TextDecoder().decode(log), pin.version, b.version) : [],
      })
    }
    const wanted = options.to?.version
    let chosen: Candidate | undefined
    let note: string | undefined
    if (wanted !== undefined) {
      chosen = candidates.find((c) => c.version === wanted)
      if (!chosen) note = compareVersions(wanted, pin.version) <= 0 ? `${wanted} is not newer than the pinned ${pin.version}` : `no build of ${pin.id}@${wanted} under --from`
      else if (!chosen.runsOnThisEngine) {
        note = `${pin.id}@${wanted} declares engines.pwfabric "${chosen.engines}", which excludes this engine (${engine})`
        chosen = undefined
      }
    } else {
      chosen = candidates.find((c) => c.runsOnThisEngine)
      if (!chosen && candidates.length > 0) note = `every newer build excludes this engine (${engine})`
    }
    let repinned: boolean | undefined
    if (chosen && !options.check) {
      await addPack(root, chosen.source)
      repinned = true
    }
    results.push({ id: pin.id, pinned: pin.version, compared: pinned !== undefined, candidates, ...(chosen ? { chosen: chosen.version } : {}), ...(repinned ? { repinned } : {}), ...(note ? { note } : {}) })
  }
  return results
}

function parseTo(value: string | undefined): UpgradeOptions['to'] {
  if (value === undefined) return undefined
  const at = value.lastIndexOf('@')
  if (at <= 0 || !parseVersion(value.slice(at + 1))) throw new UsageError(`--to takes <pack id>@<version>, e.g. @pwpack/acme/kit@2.1.0 (not "${value}")`)
  return { id: value.slice(0, at), version: value.slice(at + 1) }
}

export async function runUpgrade(args: ParsedArgs, io: CommandIO): Promise<number> {
  if (args.positionals.length > 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const from = stringFlags(args, 'from').map((p) => resolveFrom(io.cwd, p))
  const check = boolFlag(args, 'check')
  const to = parseTo(stringFlag(args, 'to'))
  const results = await upgradePacks(root, { from, check, ...(to ? { to } : {}) })
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify({ check, packs: results }, null, 2))
    return results.some((r) => r.note && to) ? 1 : 0
  }
  if (from.length === 0) {
    io.out('pwf keeps no registry of pack versions: name the newer builds with --from <.pwpack|folder>.')
    io.out('A pack from your PhiWebs workspace is moved to the version installed there with `pwf add <pack id>`.')
  }
  for (const r of results) {
    io.out(`${r.id}@${r.pinned}`)
    if (r.candidates.length === 0) io.out(`  no newer build${from.length ? ' under --from' : ''}`)
    for (const c of r.candidates) {
      io.out(`  ${c.version}${c.major ? ' (new major: expect breaking changes)' : ''}${c.runsOnThisEngine ? '' : ` — excludes this engine (engines.pwfabric "${c.engines}")`}`)
      if (!r.compared) io.out(`    the pinned build is not cached, so nothing was compared (pwf add ${r.id}@${r.pinned})`)
      for (const id of c.removedBlocks) io.out(`    block removed: ${id}`)
      if (c.usedRemovedBlocks.length > 0) io.out(`      used at ${c.usedRemovedBlocks.join(', ')}`)
      for (const p of c.removedProps) io.out(`    prop removed: ${p.block} ${p.prop}${p.usedAt.length ? ` — set at ${p.usedAt.join(', ')}` : ''}`)
      for (const n of c.removedPatterns) io.out(`    pattern removed: ${n}`)
      if (c.changelog.length > 0) for (const line of c.changelog) io.out(`    | ${line}`)
      else io.out('    (no CHANGELOG.md in this build: changed behaviour, renamed values and new required props are not known to pwf)')
    }
    if (r.note) io.err(`  ${r.note}`)
    if (r.chosen) io.out(r.repinned ? `  re-pinned to ${r.chosen}` : `  would re-pin to ${r.chosen} (run without --check)`)
  }
  if (results.length === 0) io.out(to ? `the app pins no ${to.id}` : 'the app pins no packs')
  return results.some((r) => r.note && to) ? 1 : 0
}

export const upgrade: Command = {
  name: 'upgrade',
  summary: "Move the app's pinned packs to newer builds, reporting what changed between them",
  usage: `pwf upgrade [--check] [--from <.pwpack|folder>]... [--to <pack id>@<version>] [--dir <app>] [--json]

  --from <path>  a newer pack build: a .pwpack, a pack folder, or a folder
                 holding several (repeatable)
  --to <ref>     upgrade only this pack, to exactly this version
  --check        report only; change nothing
  --dir <path>   the app folder (default: the current folder)

pwf keeps no registry of pack versions, so the newer builds are the ones
--from names; a pack of your PhiWebs workspace is moved to the version
installed there with \`pwf add <pack id>\`. For each pinned pack with a newer
build: whether its engines.pwfabric admits this engine, whether its major
changed, the blocks, props (definition.props) and patterns the pinned build
has and the newer one does not, with the receipts that still use them (e.g.
a navbar's sticky), and the build's CHANGELOG.md between the two versions
when it carries one. What pwf cannot know is said so: a changed default, a
renamed enum value or a new behaviour shows only in a changelog.

Without --check each pack is re-pinned to its newest build this engine runs
(or the --to version), as \`pwf add\` installs it (cache, pin, requires
^<major>.0.0). Exit 1 when --to names a version that cannot be used.`,
  run: (args, io) => guard('upgrade', io, () => runUpgrade(args, io)),
}
