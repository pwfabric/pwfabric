import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createLocalHost } from '../../host/local-host.js'
import type { LocalHost, LocalHostOptions } from '../../host/types.js'

export const PREFIX = '/_host'

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../__fixtures__/${name}/`, import.meta.url))
}

export interface Served {
  readonly host: LocalHost
  readonly origin: string
  /** `<origin><prefix>` — the app's own API base. */
  readonly base: string
  close(): Promise<void>
}

/** Mounts a local host on a fresh `node:http` server on port 0. */
export async function serve(name: string, options: Partial<LocalHostOptions> = {}): Promise<Served> {
  const host = createLocalHost({ root: fixture(name), prefix: PREFIX, ...options })
  const server: Server = createServer((req, res) => {
    void host.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not the host')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  return {
    host,
    origin,
    base: origin + (options.prefix ?? PREFIX).replace(/\/+$/, ''),
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

/** A `sessionStorage` stand-in. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }
}
