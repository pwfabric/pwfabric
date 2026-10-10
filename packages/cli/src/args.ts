import type { ParsedArgs } from './commands/types.js'

/**
 * Splits argv (without the node binary and script) into the command name and
 * its arguments. `--flag value` and `--flag=value` become strings, a bare
 * `--flag` (or one followed by another flag) becomes true, and everything
 * after a lone `--` is positional.
 */
export function parseArgs(argv: readonly string[]): { command: string | undefined; args: ParsedArgs } {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  let rest = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (rest) {
      positionals.push(a)
    } else if (a === '--') {
      rest = true
    } else if (a.startsWith('--')) {
      const body = a.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      }
    } else {
      positionals.push(a)
    }
  }
  const [command, ...rest_] = positionals
  return { command, args: { positionals: rest_, flags } }
}
