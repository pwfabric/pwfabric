/**
 * `pwf shoot [out]` — screenshots of a built app's pages: served as
 * `pwf run` serves it, opened in Chromium (Playwright, an optional peer) at
 * each width and colour scheme asked for, one PNG per page, width and scheme.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, stringFlags, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { readBuiltOutput } from './lib/built-output.js'
import { loadPlaywright, PLAYWRIGHT_MISSING, type PlaywrightLoader } from './lib/hydration.js'
import { startStaticServer } from './lib/static-server.js'
import { PIN_FIXED_ELEMENTS } from './lib/pin-fixed.js'
import { appFolderOf, openRunSource, readOnlyHostFor } from './run.js'
import { HOST_PREFIX } from '../dev/server.js'
import { isObject } from './lib/app-files.js'

const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]

/** A file name for one address: `home`, `pricing`, `de-preise`. */
export function shotName(address: string): string {
  const slug = address.replace(/^\/?(?:#\/?)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
  return slug === '' ? 'home' : slug
}

export interface ShootDeps {
  readonly loadPlaywright?: PlaywrightLoader
  /** How long a page settles before its picture is taken (ms). */
  readonly settleMs?: number
}

export async function runShoot(args: ParsedArgs, io: CommandIO, deps: ShootDeps = {}): Promise<number> {
  if (args.positionals.length > 1) throw new UsageError(`unexpected argument "${args.positionals[1]}"`)
  const target = resolveFrom(io.cwd, args.positionals[0] ?? '.')
  const widths = (stringFlag(args, 'widths') ?? '390,1440').split(',').map((w) => Number(w.trim()))
  if (widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) throw new UsageError('--widths takes window widths in pixels, e.g. 390,1440')
  const themes = (stringFlag(args, 'theme') ?? 'light').split(',').map((t) => t.trim())
  for (const t of themes) if (!(THEMES as readonly string[]).includes(t)) throw new UsageError(`--theme takes light, dark or both (not "${t}")`)
  const out = await readBuiltOutput(target)
  const project = (() => {
    try {
      const v = JSON.parse(new TextDecoder().decode(out.files.get('pwpack/project.json'))) as unknown
      return isObject(v) ? v : {}
    } catch {
      return {}
    }
  })()

  // The addresses: every page (in the locale asked for), or those --path names.
  let addresses: string[]
  const paths = stringFlags(args, 'path')
  const locale = stringFlag(args, 'locale')
  if (paths.length > 0) {
    addresses = paths.map((p) => (p.startsWith('#') ? `/${p}` : p.startsWith('/') ? p : `/${p}`))
  } else {
    let rows: readonly string[] = out.addresses
    if (locale !== undefined) {
      const table = isObject(project['addresses']) ? project['addresses'] : undefined
      const row = table?.[locale]
      if (!isObject(row)) throw new UsageError(`--locale ${locale}: the app has no such locale${table ? ` (it has ${Object.keys(table).join(', ')})` : ''}`)
      rows = Object.values(row).filter((a): a is string => typeof a === 'string')
    }
    addresses = rows.map((a) => (out.router === 'path' ? `/${a}` : `/#/${a}`))
  }

  const chromium = await (deps.loadPlaywright ?? loadPlaywright)(io.cwd)
  if (!chromium) {
    io.err(`pwf shoot: ${PLAYWRIGHT_MISSING}`)
    return 1
  }
  const app = await appFolderOf(target)
  const dirFlag = stringFlag(args, 'out')
  const dir = dirFlag ? resolveFrom(io.cwd, dirFlag) : app ? join(app, '.pwf', 'shots') : join(io.cwd, 'shots')
  await mkdir(dir, { recursive: true })
  const host = app ? await readOnlyHostFor(app) : undefined
  const server = await startStaticServer({ source: await openRunSource(target), port: 0, hostname: '127.0.0.1', hostPrefix: HOST_PREFIX, ...(host ? { host } : {}) })
  const browser = await chromium.launch()
  const written: string[] = []
  try {
    const origin = server.url.replace(/\/$/, '')
    for (const address of addresses) {
      for (const width of widths) {
        for (const theme of themes as Theme[]) {
          const page = await browser.newPage({ viewport: { width, height: 900 } })
          await page.emulateMedia({ colorScheme: theme })
          await page.goto(`${origin}${address}`)
          await page.waitForTimeout(deps.settleMs ?? 1500)
          const file = join(dir, `${shotName(address)}@${width}${themes.length > 1 || theme === 'dark' ? `-${theme}` : ''}.png`)
          // A fixed element in the place a visitor sees it, not wherever the window was.
          await page.evaluate(PIN_FIXED_ELEMENTS)
          await page.screenshot({ path: file, fullPage: true })
          await page.close()
          written.push(file)
        }
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }
  if (boolFlag(args, 'json')) io.out(JSON.stringify({ dir, files: written }, null, 2))
  else {
    for (const f of written) io.out(`  ${f}`)
    io.out(`${written.length} screenshot${written.length === 1 ? '' : 's'} in ${dir}`)
  }
  return 0
}

export const shoot: Command = {
  name: 'shoot',
  summary: "Screenshot a built app's pages at chosen widths and colour schemes (needs Playwright)",
  usage: `pwf shoot [out] [--path <address>]... [--widths 390,1440] [--theme light,dark] [--locale <lang>]
          [--out <dir>] [--json]

  out              the built pwapp (a folder with index.html, an app folder
                   or a .pwapp; default: the current folder)
  --path <addr>    an address to shoot, from the base: /pricing/, #/pricing,
                   /pricing/?id=3 (repeatable; default: every page)
  --widths <px>    window widths (default 390,1440)
  --theme <list>   light, dark or light,dark: the colour scheme the browser
                   reports (default light)
  --locale <lang>  every page of one locale, in an app with locales
  --out <dir>      where the PNGs go (default: <app>/.pwf/shots, else ./shots)

Serves the build as pwf run does (an app's records read-only), opens each
address in Chromium and writes one full-page PNG per address, width and
scheme: <page>@<width>[-<theme>].png. Needs Playwright beside the app or pwf
(an optional peer); without it pwf says how to install it and exits 1.`,
  run: (args, io) => guard('shoot', io, () => runShoot(args, io)),
}
