/**
 * `pwf doctor [dir]` — what this pwf runs with and what the folder needs
 * from it: the CLI and engine versions, Node, the folder's engine range and
 * pinned packs (cached, matching their pin, made for this engine — each
 * problem with the command that fixes it), how its builds route, its
 * languages, its font files, and whether pwf is signed in to PhiWebs. It
 * reads files only; `--online` asks PhiWebs who the session belongs to
 * (as `pwf whoami`), and only when there is a session.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { localesOf } from '@pwfabric/contracts'
import { satisfiesSemverRange } from '@pwfabric/contracts/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag } from './lib/flags.js'
import { cacheDir, cacheRelDir, readCachedPack, resolveFrom } from './lib/project.js'
import { engineRange, engineVersion, pinsOf, readIdentityFile, type IdentityJson, type PackPin } from './lib/identity.js'
import { isObject, PLAN_FILE, readJsonObject } from './lib/app-files.js'
import { hashPack, validatePack } from '@pwfabric/pack'
import { cliVersion } from '../version.js'
import { readTokens, serverUrl, type StoreOptions } from '../phiwebs/config.js'
import { whoamiCommand } from './login.js'

/** The Node release pwf needs (package.json engines.node). */
export const NODE_MAJOR = 22

export interface Finding {
  readonly severity: 'ok' | 'warning' | 'error' | 'info'
  readonly code?: string
  readonly message: string
  readonly fix?: string
}

export interface PinState {
  readonly id: string
  readonly version: string
  readonly cached: boolean
  readonly hashMatches?: boolean
  readonly engines?: string
  readonly runsOnThisEngine?: boolean
}

export interface DoctorReport {
  readonly pwf: string
  readonly engine: string
  readonly node: { readonly version: string; readonly ok: boolean }
  readonly folder?: {
    readonly path: string
    readonly id: string
    readonly version: string
    readonly kind: 'app' | 'pack'
    readonly engines?: string
    readonly pins: readonly PinState[]
    readonly routing?: { readonly origin?: string; readonly redirects: number; readonly headers: number; readonly lastBuild?: string }
    readonly locales?: { readonly locales: readonly string[]; readonly defaultLocale: string } | { readonly locale: string | null }
    readonly fonts?: { readonly files: number; readonly bytes: number }
  }
  readonly phiwebs: { readonly server: string; readonly signedIn: boolean; readonly studio: boolean; readonly expired?: boolean }
  readonly findings: readonly Finding[]
}

const releaseOf = (v: string): string => v.replace(/-.*$/, '')

async function filesUnder(dir: string): Promise<{ files: number; bytes: number } | undefined> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => null)
  if (!entries) return undefined
  let files = 0
  let bytes = 0
  for (const e of entries) {
    if (!e.isFile()) continue
    files++
    bytes += (await stat(join(e.parentPath ?? (e as unknown as { path: string }).path, e.name))).size
  }
  return { files, bytes }
}

export interface DoctorDeps extends Partial<Omit<StoreOptions, 'env'>> {
  readonly now?: () => number
  readonly nodeVersion?: string
  readonly engine?: string
}

export async function doctor(root: string, env: StoreOptions['env'], deps: DoctorDeps = {}): Promise<DoctorReport> {
  const findings: Finding[] = []
  const engine = deps.engine ?? engineVersion()
  const nodeVersion = deps.nodeVersion ?? process.versions.node
  const nodeOk = Number(nodeVersion.split('.')[0]) >= NODE_MAJOR
  if (!nodeOk) findings.push({ severity: 'error', code: 'NODE_TOO_OLD', message: `Node ${nodeVersion}; pwf needs Node ${NODE_MAJOR} or later`, fix: `install Node ${NODE_MAJOR} (nodejs.org, or your version manager)` })

  let folder: DoctorReport['folder']
  let identity: IdentityJson | undefined
  try {
    identity = await readIdentityFile(root)
  } catch {
    identity = undefined
  }
  if (identity) {
    const id = String(identity['id'])
    const version = String(identity['version'])
    const engines = isObject(identity['engines']) && typeof identity['engines']['pwfabric'] === 'string' ? identity['engines']['pwfabric'] : undefined
    if (engines && !satisfiesSemverRange(releaseOf(engine), engines)) {
      findings.push({
        severity: 'error',
        code: 'ENGINE_RANGE_EXCLUDED',
        message: `${id} declares engines.pwfabric "${engines}", which excludes this engine (${engine})`,
        fix: `move the folder to this engine and set engines.pwfabric to "${engineRange(engine)}" in pwpack.json, or run it with a pwf whose engine the range names`,
      })
    }
    const pins: PinState[] = []
    for (const pin of pinsOf(identity as { packs?: PackPin[] })) {
      let dir: string
      try {
        dir = cacheDir(root, pin.id, pin.version)
      } catch {
        findings.push({ severity: 'error', code: 'PIN_INVALID', message: `${pin.id}@${pin.version} is not usable as a cache folder name` })
        continue
      }
      const pack = await readCachedPack(dir).catch(() => null)
      if (!pack) {
        pins.push({ id: pin.id, version: pin.version, cached: false })
        findings.push({
          severity: 'error',
          code: 'PIN_NOT_CACHED',
          message: `${pin.id}@${pin.version} is pinned but not in ${cacheRelDir(pin.id, pin.version)}/`,
          fix: /^@pwpack\//.test(pin.id) ? `pwf add ${pin.id}@${pin.version} (from your PhiWebs workspace, after pwf login), or pwf add <its .pwpack or folder>` : `pwf add <the .pwpack or folder of ${pin.id}@${pin.version}>`,
        })
        continue
      }
      const hashMatches = hashPack(pack) === pin.hash
      if (!hashMatches) findings.push({ severity: 'error', code: 'PIN_HASH_MISMATCH', message: `the cached ${pin.id}@${pin.version} is not the build the pin names`, fix: `pwf add the build you mean to pin again (it re-pins by its hash)` })
      const packEngines = validatePack(pack).identity?.engines?.pwfabric
      const runs = !packEngines || satisfiesSemverRange(releaseOf(engine), packEngines)
      if (!runs) {
        findings.push({
          severity: 'error',
          code: 'ENGINE_RANGE_EXCLUDED',
          message: `${pin.id}@${pin.version} declares engines.pwfabric "${packEngines}", which excludes this engine (${engine})`,
          fix: `pin a version made for this engine: pwf upgrade --from <its newer .pwpack or folder>, or pwf add ${pin.id}@<version>`,
        })
      }
      pins.push({ id: pin.id, version: pin.version, cached: true, hashMatches, ...(packEngines ? { engines: packEngines } : {}), runsOnThisEngine: runs })
    }
    const isApp = isObject(identity['app'])
    let routing: NonNullable<DoctorReport['folder']>['routing']
    let locales: NonNullable<DoctorReport['folder']>['locales']
    if (isApp) {
      const plan = (await readJsonObject(root, PLAN_FILE).catch(() => undefined)) ?? {}
      const built = await readFile(join(root, '.pwf', 'out', 'index.html'), 'utf8').catch(() => null)
      const lastBuild = built === null ? undefined : (await stat(join(root, '.pwf', 'out', '404.html')).catch(() => null)) ? 'path' : 'hash'
      routing = {
        ...(typeof plan['origin'] === 'string' ? { origin: plan['origin'] } : {}),
        redirects: Array.isArray(plan['redirects']) ? plan['redirects'].length : 0,
        headers: Array.isArray(plan['headers']) ? plan['headers'].length : 0,
        ...(lastBuild ? { lastBuild } : {}),
      }
      if (typeof plan['origin'] !== 'string') findings.push({ severity: 'info', message: 'app/plan.json names no "origin": builds write no canonical address, sitemap.xml or llms.txt' })
      const decl = localesOf(plan)
      locales = decl ? { locales: decl.locales, defaultLocale: decl.defaultLocale } : { locale: typeof plan['locale'] === 'string' ? plan['locale'] : null }
      if (decl && lastBuild === 'hash') findings.push({ severity: 'info', message: 'the last build routes by hash: an app with locales is found per language only when built with --router path' })
    }
    const fonts = await filesUnder(join(root, 'media', 'fonts'))
    folder = { path: root, id, version, kind: isApp ? 'app' : 'pack', ...(engines ? { engines } : {}), pins, ...(routing ? { routing } : {}), ...(locales ? { locales } : {}), ...(fonts ? { fonts } : {}) }
  } else {
    findings.push({ severity: 'info', message: `${root} is not a pwpack folder (no pwpack.json): only pwf itself is checked` })
  }

  const server = serverUrl(undefined, env)
  const store: StoreOptions = { env, ...(deps.platform ? { platform: deps.platform } : {}), ...(deps.home ? { home: deps.home } : {}) }
  const tokens = await readTokens(server, store).catch(() => null)
  const now = (deps.now ?? Date.now)()
  const expired = tokens?.expiresAt !== undefined && tokens.expiresAt < now && !tokens.refreshToken
  const phiwebs = { server, signedIn: tokens !== null, studio: tokens?.studio !== undefined, ...(tokens ? { expired } : {}) }
  if (tokens && !tokens.studio) findings.push({ severity: 'warning', message: 'the PhiWebs session has no studio sign-in: pwf publish needs one', fix: 'pwf login' })
  if (expired) findings.push({ severity: 'warning', message: 'the PhiWebs session has expired and cannot be renewed', fix: 'pwf login' })
  return { pwf: cliVersion(), engine, node: { version: nodeVersion, ok: nodeOk }, ...(folder ? { folder } : {}), phiwebs, findings }
}

export async function runDoctor(args: ParsedArgs, io: CommandIO, deps: DoctorDeps = {}): Promise<number> {
  const root = resolveFrom(io.cwd, args.positionals[0] ?? stringFlag(args, 'dir'))
  const report = await doctor(root, io.env, deps)
  const failed = report.findings.some((f) => f.severity === 'error')
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify(report, null, 2))
    return failed ? 1 : 0
  }
  io.out(`pwf ${report.pwf}, engine ${report.engine}, Node ${report.node.version}${report.node.ok ? '' : ' (too old)'}`)
  const f = report.folder
  if (f) {
    io.out(`${f.kind} ${f.id}@${f.version}${f.engines ? `, engines.pwfabric "${f.engines}"` : ''}`)
    if (f.pins.length === 0) io.out('  pins: none')
    for (const p of f.pins) {
      const state = !p.cached ? 'NOT CACHED' : p.hashMatches === false ? 'HASH DIFFERS' : p.runsOnThisEngine === false ? `excludes this engine ("${p.engines}")` : 'cached, matches its pin'
      io.out(`  pin ${p.id}@${p.version}: ${state}`)
    }
    if (f.routing) {
      io.out(`  routing: ${f.routing.lastBuild ? `last build routes by ${f.routing.lastBuild}` : 'not built yet'}; origin ${f.routing.origin ?? 'none'}; ${f.routing.redirects} redirect${f.routing.redirects === 1 ? '' : 's'}, ${f.routing.headers} header rule${f.routing.headers === 1 ? '' : 's'}`)
    }
    if (f.locales) io.out(`  languages: ${'locales' in f.locales ? `${f.locales.locales.join(', ')} (default ${f.locales.defaultLocale})` : (f.locales.locale ?? 'none named')}`)
    if (f.fonts) io.out(`  fonts: ${f.fonts.files} file${f.fonts.files === 1 ? '' : 's'} in media/fonts (${(f.fonts.bytes / 1024).toFixed(1)} KB)`)
  }
  io.out(`PhiWebs (${report.phiwebs.server}): ${report.phiwebs.signedIn ? `signed in${report.phiwebs.studio ? ', with the studio' : ''}` : 'not signed in (pwf login; only pwf publish, pwf add <pack id> and the PhiWebs tools of pwf mcp need it)'}`)
  for (const finding of report.findings) {
    const line = `${finding.severity === 'error' ? 'ERROR' : finding.severity === 'warning' ? 'warning' : 'note'}${finding.code ? ` ${finding.code}` : ''}: ${finding.message}`
    if (finding.severity === 'error') io.err(line)
    else io.out(line)
    if (finding.fix) {
      if (finding.severity === 'error') io.err(`  fix: ${finding.fix}`)
      else io.out(`  fix: ${finding.fix}`)
    }
  }
  if (boolFlag(args, 'online') && report.phiwebs.signedIn) {
    io.out('')
    await whoamiCommand.run({ positionals: [], flags: {} }, io)
  }
  return failed ? 1 : 0
}

export const doctorCommand: Command = {
  name: 'doctor',
  summary: 'Show what pwf runs with and what the folder needs: engine, Node, packs, routing, languages, sign-in',
  usage: `pwf doctor [dir] [--online] [--json]

  dir        the app or pack folder (default: the current folder)
  --online   also ask PhiWebs who the session belongs to (pwf whoami), when
             signed in; without it pwf doctor reads files only
  --json     the report as data

Prints the pwf and engine versions and Node's; for a pwpack folder, its
engines.pwfabric range and each pinned pack — cached in .pwf/packs, its
content hash the pin's, its own engines.pwfabric admitting this engine —
with the command that fixes each problem (PIN_NOT_CACHED: pwf add;
ENGINE_RANGE_EXCLUDED: the range to write, or pwf upgrade); for an app also
its routing (the last build's router, the plan's origin, redirects and
header rules), its languages and its font files (media/fonts). Then whether
pwf is signed in to PhiWebs, read from the saved session without a network
request. Exit 1 when anything is an error.`,
  run: (args, io) => guard('doctor', io, () => runDoctor(args, io)),
}
