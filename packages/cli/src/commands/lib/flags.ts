import type { CommandIO, ParsedArgs } from '../types.js'
import { CommandFailure } from './failure.js'
import { printIssues } from './issues.js'
import { CorsOriginError, corsOriginsOf, type CorsOrigins } from '../../dev/cors.js'

/** Thrown for a malformed invocation; commands turn it into exit code 2. */
export class UsageError extends Error {}

/** A flag that takes a value: absent → undefined, bare `--flag` → UsageError. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name]
  if (v === undefined) return undefined
  if (v === true || v === '') throw new UsageError(`--${name} needs a value`)
  return v as string
}

/** A flag that takes a value and may be repeated: every value, in order (none → []). A bare one is a UsageError. */
export function stringFlags(args: ParsedArgs, name: string): string[] {
  const all = args.lists?.[name] ?? (args.flags[name] === undefined ? [] : [args.flags[name] as string | boolean])
  return all.map((v) => {
    if (v === true || v === false || v === '') throw new UsageError(`--${name} needs a value`)
    return v
  })
}

/** A switch: present (bare or with any value but "false") → true. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  const v = args.flags[name]
  return v !== undefined && v !== false && v !== 'false'
}

/**
 * Runs a command body, turning usage errors into exit 2 and other failures into
 * exit 1. A {@link CommandFailure} prints its own lines (or the message) and
 * its findings.
 */
export async function guard(name: string, io: CommandIO, body: () => Promise<number>): Promise<number> {
  try {
    return await body()
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`pwf ${name}: ${e.message}`)
      io.err(`Run \`pwf ${name} --help\` for usage.`)
      return 2
    }
    if (e instanceof CommandFailure) {
      if (e.issuesFirst) printIssues(io, e.issues)
      if (e.lines) for (const line of e.lines) io.err(line)
      else io.err(`pwf ${name}: ${e.message}`)
      if (!e.issuesFirst) printIssues(io, e.issues)
      return 1
    }
    io.err(`pwf ${name}: ${(e as Error).message}`)
    return 1
  }
}

/** The origins `--cors` names (repeatable, `pwf run` and `pwf dev`); a value that is not one exact origin is a UsageError. */
export function corsFlags(args: ParsedArgs): CorsOrigins {
  try {
    return corsOriginsOf(stringFlags(args, 'cors'))
  } catch (e) {
    if (e instanceof CorsOriginError) throw new UsageError(e.message)
    throw e
  }
}
