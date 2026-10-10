/**
 * The contract every `pwf` command implements.
 *
 * A command is a plain object registered in ./registry.ts. It never calls
 * `process.exit` and never writes to `process.stdout` directly: it writes
 * through the `io` it is given and returns an exit code. That keeps every
 * command testable in-process.
 */

export interface CommandIO {
  /** Working directory the command runs in (absolute). */
  readonly cwd: string
  /** Normal output. */
  out(line: string): void
  /** Diagnostics and errors. */
  err(line: string): void
  /** Environment variables visible to the command. */
  readonly env: Readonly<Record<string, string | undefined>>
}

export interface ParsedArgs {
  /** Positional arguments after the command name. */
  readonly positionals: readonly string[]
  /** `--flag value` and `--flag=value` become strings; bare `--flag` becomes true. */
  readonly flags: Readonly<Record<string, string | boolean>>
}

export interface Command {
  /** The word after `pwf`, e.g. `create`. */
  readonly name: string
  /** One line shown by `pwf help`. */
  readonly summary: string
  /** Usage line, e.g. `pwf create <name> [--dir <path>]`. */
  readonly usage: string
  /** Runs the command. Resolves to the process exit code (0 = success). */
  run(args: ParsedArgs, io: CommandIO): Promise<number>
}
