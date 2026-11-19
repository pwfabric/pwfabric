import { readFileSync } from 'node:fs'

/** This package's own version, from its package.json one level above dist/. */
export function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  return typeof pkg.version === 'string' ? pkg.version : 'unknown'
}
