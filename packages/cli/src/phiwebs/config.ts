/**
 * Where `pwf login` keeps what it knows: which PhiWebs server, the OAuth
 * client registered with it, and the tokens. Everything lives in the user's
 * config folder — `%APPDATA%\pwfabric` on Windows, `$XDG_CONFIG_HOME/pwfabric`
 * or `~/.config/pwfabric` elsewhere — in files only the user may read.
 *
 * Nothing here is used by the account-free commands: they never read it.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { CommandFailure } from '../commands/lib/failure.js'

/** The PhiWebs API `pwf login` signs in to unless told otherwise. */
export const DEFAULT_PHIWEBS_URL = 'https://api.phiwebs.com'
/** Environment variable naming another server (local or staging work); `--server` wins over it. */
export const PHIWEBS_URL_ENV = 'PWF_PHIWEBS_URL'

/** Tokens saved per server. */
export const CREDENTIALS_FILE = 'credentials.json'
/** OAuth clients registered per server (no secrets: public clients with PKCE). */
export const CLIENTS_FILE = 'clients.json'

export type Env = Readonly<Record<string, string | undefined>>

/** Where the files live and how time is read; tests point these elsewhere. */
export interface StoreOptions {
  readonly env: Env
  readonly platform?: NodeJS.Platform
  readonly home?: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Whether `url` is http on this machine (the only place plain http is accepted). */
export function isLoopback(url: URL): boolean {
  return LOOPBACK.has(url.hostname)
}

/**
 * The server to talk to: `flag`, else `PWF_PHIWEBS_URL`, else the default —
 * normalised to origin plus path, without a trailing slash. Only https is
 * accepted, except http on this machine.
 */
export function serverUrl(flag: string | undefined, env: Env): string {
  const raw = flag ?? env[PHIWEBS_URL_ENV] ?? DEFAULT_PHIWEBS_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CommandFailure('SERVER_INVALID', `"${raw}" is not a URL`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
    throw new CommandFailure('SERVER_INVALID', `${raw}: the server must be https (http only on localhost)`)
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** The folder the files live in. */
export function configDir(options: StoreOptions): string {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  if (platform === 'win32') {
    const appData = options.env['APPDATA']
    return join(appData && isAbsolute(appData) ? appData : join(home, 'AppData', 'Roaming'), 'pwfabric')
  }
  const xdg = options.env['XDG_CONFIG_HOME']
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.config'), 'pwfabric')
}

/** A client registered with a server's registration endpoint (RFC 7591). */
export interface SavedClient {
  readonly clientId: string
  /** The one redirect address registered for it: the server compares it exactly. */
  readonly redirectUri: string
  readonly registrationEndpoint: string
}

/** A signed-in session with one server. */
export interface SavedTokens {
  readonly accessToken: string
  readonly refreshToken?: string
  /** Epoch milliseconds; absent when the server said nothing about expiry. */
  readonly expiresAt?: number
  readonly scope?: string
  readonly clientId: string
  readonly tokenEndpoint: string
  readonly revocationEndpoint?: string
}

type Store<T> = { [server: string]: T }

async function readStore<T>(file: string): Promise<Store<T>> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return {}
  try {
    const value = JSON.parse(text) as { servers?: unknown }
    return value.servers && typeof value.servers === 'object' ? (value.servers as Store<T>) : {}
  } catch {
    return {}
  }
}

/**
 * Writes a store readable by the user only: the folder 0700, the file 0600,
 * written beside and renamed into place so a crash never leaves half a file.
 * (On Windows the modes are not applied; the user's own profile folder is
 * what keeps the file private there.)
 */
async function writeStore<T>(dir: string, name: string, servers: Store<T>): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, name)
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ servers }, null, 2)}\n`, { mode: 0o600 })
  await chmod(temp, 0o600)
  await rename(temp, file)
}

export async function readTokens(server: string, options: StoreOptions): Promise<SavedTokens | null> {
  return (await readStore<SavedTokens>(join(configDir(options), CREDENTIALS_FILE)))[server] ?? null
}

export async function saveTokens(server: string, tokens: SavedTokens, options: StoreOptions): Promise<void> {
  const dir = configDir(options)
  const all = await readStore<SavedTokens>(join(dir, CREDENTIALS_FILE))
  all[server] = tokens
  await writeStore(dir, CREDENTIALS_FILE, all)
}

/** Forgets one server's tokens; deletes the file when no server is left in it. */
export async function deleteTokens(server: string, options: StoreOptions): Promise<void> {
  const dir = configDir(options)
  const all = await readStore<SavedTokens>(join(dir, CREDENTIALS_FILE))
  delete all[server]
  if (Object.keys(all).length === 0) await rm(join(dir, CREDENTIALS_FILE), { force: true })
  else await writeStore(dir, CREDENTIALS_FILE, all)
}

export async function readClient(server: string, options: StoreOptions): Promise<SavedClient | null> {
  return (await readStore<SavedClient>(join(configDir(options), CLIENTS_FILE)))[server] ?? null
}

export async function saveClient(server: string, client: SavedClient, options: StoreOptions): Promise<void> {
  const dir = configDir(options)
  const all = await readStore<SavedClient>(join(dir, CLIENTS_FILE))
  all[server] = client
  await writeStore(dir, CLIENTS_FILE, all)
}
