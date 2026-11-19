/**
 * `pwf` — the PWFabric command line.
 *
 * Creates, develops, validates, packs and runs PWFabric applications with
 * nothing but the engine's own packages, with no account and no network.
 * `pwf mcp` serves the same work over MCP. `pwf login`, `logout` and `whoami`
 * sign in to PhiWebs, the platform PWFabric was built for, and `pwf publish`
 * publishes there; they (and the PhiWebs tools of `pwf mcp`, when signed in)
 * are the only parts that talk to a hosted service.
 */

import { parseArgs } from './args.js'
import { COMMANDS, findCommand } from './commands/registry.js'
import type { CommandIO } from './commands/types.js'
import { cliVersion } from './version.js'

export { parseArgs } from './args.js'
export { cliVersion } from './version.js'
export { COMMANDS, findCommand } from './commands/registry.js'
export type { Command, CommandIO, ParsedArgs } from './commands/types.js'
// The authoring skeletons behind `pwf create --pack` and `pwf add block`;
// `@pwfabric/cli/authoring` carries the same without the rest of pwf.
export * from './authoring.js'
export type { DevServer, DevServerOptions, DevBuildResult, StartDevServer } from './dev/types.js'
// The host building blocks have their own entry, `@pwfabric/cli/host`.
export type { LocalHost, LocalHostOptions, CreateLocalHost } from './host/index.js'
export { createLocalHost } from './host/index.js'

function help(io: CommandIO): void {
  io.out('Usage: pwf <command> [options]')
  io.out('')
  for (const c of COMMANDS) io.out(`  ${c.name.padEnd(10)} ${c.summary}`)
  io.out('')
  io.out('Run `pwf <command> --help` for the options of one command; `pwf --version` prints the version.')
}

/** Runs one invocation and resolves to its exit code. */
export async function main(argv: readonly string[], io: CommandIO): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    io.out(cliVersion())
    return 0
  }
  const { command, args } = parseArgs(argv)
  if (command === undefined || command === 'help') {
    help(io)
    return 0
  }
  const cmd = findCommand(command)
  if (!cmd) {
    io.err(`pwf: unknown command "${command}"`)
    help(io)
    return 2
  }
  if (args.flags.help === true) {
    io.out(`Usage: ${cmd.usage}`)
    io.out(cmd.summary)
    return 0
  }
  return cmd.run(args, io)
}
