import type { CommandIO, ParsedArgs } from '../types.js'

/** Thrown for a malformed invocation; commands turn it into exit code 2. */
export class UsageError extends Error {}

/** A flag that takes a value: absent → undefined, bare `--flag` → UsageError. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name]
  if (v === undefined) return undefined
  if (v === true || v === '') throw new UsageError(`--${name} needs a value`)
  return v as string
}

/** A switch: present (bare or with any value but "false") → true. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  const v = args.flags[name]
  return v !== undefined && v !== false && v !== 'false'
}

/** Runs a command body, turning usage errors into exit 2 and other failures into exit 1. */
export async function guard(name: string, io: CommandIO, body: () => Promise<number>): Promise<number> {
  try {
    return await body()
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`pwf ${name}: ${e.message}`)
      io.err(`Run \`pwf ${name} --help\` for usage.`)
      return 2
    }
    io.err(`pwf ${name}: ${(e as Error).message}`)
    return 1
  }
}
