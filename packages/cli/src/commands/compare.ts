/**
 * `pwf compare <old> <new>` — the addresses a visitor could reach in an
 * older build that the new build no longer answers: a page (its document
 * under path routing, its hash route otherwise, in every locale), the app's
 * media and public files. An address the new build redirects (`_redirects`,
 * from the plan's `redirects`) is not missing. Non-zero exit when any is.
 */
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { HOST_FILES, readBuiltOutput, resolveServed, RUNTIME_FOLDERS, type BuiltOutput } from './lib/built-output.js'

/** Every address of a build, from its base: pages (`pricing/`, `#/pricing`), media and public files. */
export function addressesOf(out: BuiltOutput): string[] {
  const all = new Set<string>()
  if (out.router === 'path') {
    for (const a of out.addresses) all.add(a)
  } else {
    for (const a of out.addresses) all.add(`#/${a}`)
  }
  // An older build wrote a copy of the app per locale (`en/index.html` with its
  // own runtime folders and `en/pwpack/`): its files are runtime, not addresses.
  const nestedRoots = new Set<string>()
  for (const rel of out.files.keys()) {
    const at = rel.indexOf('/pwpack/')
    if (at > 0 && out.files.has(`${rel.slice(0, at)}/index.html`)) nestedRoots.add(`${rel.slice(0, at)}/`)
  }
  for (const rel of out.files.keys()) {
    if (RUNTIME_FOLDERS.some((f) => rel.startsWith(f))) continue
    // A host's manifest (publish.json, _headers, _redirects, project.json), at any depth: not an address.
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (HOST_FILES.has(name) || name === 'project.json') continue
    if (rel.startsWith('pwpack/') && !rel.startsWith('pwpack/media/')) continue
    const nested = [...nestedRoots].find((r) => rel.startsWith(r))
    if (nested !== undefined) {
      const inner = rel.slice(nested.length)
      if (inner.startsWith('pwpack/') || RUNTIME_FOLDERS.some((f) => inner.startsWith(f))) continue
    }
    if (rel === 'index.html' || rel === '404.html' || rel.endsWith('/index.html')) continue // a page's document: its address is above
    all.add(rel)
  }
  return [...all].sort()
}

/** Whether the new build answers an address of the old one: it has it, or redirects it to something it serves (or off-site). */
function answers(next: BuiltOutput, nextAddresses: ReadonlySet<string>, address: string): { ok: boolean; redirectedTo?: string } {
  if (nextAddresses.has(address)) return { ok: true }
  if (address.startsWith('#/')) return { ok: false } // a hash route cannot be redirected by a host
  const served = resolveServed(next, address)
  if (served.file && served.file !== '404.html') return { ok: true, ...(served.redirectedTo ? { redirectedTo: served.redirectedTo } : {}) }
  if (served.redirectedTo && /^https?:\/\//i.test(served.redirectedTo)) return { ok: true, redirectedTo: served.redirectedTo }
  return { ok: false }
}

export interface Comparison {
  readonly old: string
  readonly new: string
  readonly missing: readonly string[]
  readonly redirected: readonly { readonly address: string; readonly to: string }[]
  readonly added: readonly string[]
}

export async function compareBuilds(oldPath: string, newPath: string): Promise<Comparison> {
  const [a, b] = await Promise.all([readBuiltOutput(oldPath), readBuiltOutput(newPath)])
  const before = addressesOf(a)
  const after = new Set(addressesOf(b))
  const missing: string[] = []
  const redirected: { address: string; to: string }[] = []
  for (const address of before) {
    const r = answers(b, after, address)
    if (!r.ok) missing.push(address)
    else if (r.redirectedTo) redirected.push({ address, to: r.redirectedTo })
  }
  const old = new Set(before)
  return { old: a.label, new: b.label, missing, redirected, added: [...after].filter((x) => !old.has(x)) }
}

export async function runCompare(args: ParsedArgs, io: CommandIO): Promise<number> {
  const [oldArg, newArg, extra] = args.positionals
  if (oldArg === undefined || newArg === undefined) throw new UsageError('give the old build and the new one: pwf compare <old> <new>')
  if (extra !== undefined) throw new UsageError(`unexpected argument "${extra}"`)
  const result = await compareBuilds(resolveFrom(io.cwd, oldArg), resolveFrom(io.cwd, newArg))
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify(result, null, 2))
    return result.missing.length > 0 ? 1 : 0
  }
  for (const r of result.redirected) io.out(`redirected  /${r.address} → ${r.to}`)
  for (const m of result.missing) io.err(`MISSING     /${m}`)
  io.out(`${result.missing.length} address${result.missing.length === 1 ? '' : 'es'} of the old build missing in the new, ${result.redirected.length} redirected, ${result.added.length} new`)
  if (result.missing.length > 0) io.err('Keep the pages, or add redirects for them to app/plan.json "redirects" ({ from, to, status }), then build again.')
  return result.missing.length > 0 ? 1 : 0
}

export const compare: Command = {
  name: 'compare',
  summary: 'List the addresses an older build answered that a new build no longer does',
  usage: `pwf compare <old> <new> [--json]

  <old>, <new>  two built pwapps: folders with index.html, app folders (their
                .pwf/out) or .pwapp archives

An address is a page in every locale (its document under path routing, its
#/ route under hash routing), a media file (pwpack/media/…) or a public
file. One the old build has and the new one does not is MISSING, unless the
new build's _redirects sends it to something the new build serves or to
another site. A hash route cannot be redirected by a host. Exit 1 when any
address is missing, so a build that would break links people kept can stop
a release. (Keep a copy of the published build to compare against: build
into another folder with pwf build --out.)`,
  run: (args, io) => guard('compare', io, () => runCompare(args, io)),
}
