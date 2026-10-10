/**
 * `pwf` — the PWFabric command line.
 *
 * Creates, develops, validates, packs and runs PWFabric applications with
 * nothing but the engine's own packages. It never calls a hosted service:
 * there is no login, publish or deploy here.
 */

import { parseArgs } from './args.js'
import { COMMANDS, findCommand } from './commands/registry.js'
import type { CommandIO } from './commands/types.js'

export { parseArgs } from './args.js'
export { COMMANDS, findCommand } from './commands/registry.js'
export type { Command, CommandIO, ParsedArgs } from './commands/types.js'
export type { DevServer, DevServerOptions, DevBuildResult, StartDevServer } from './dev/types.js'
export type { LocalHost, LocalHostOptions, CreateLocalHost } from './host/types.js'
export { createLocalHost } from './host/local-host.js'

function help(io: CommandIO): void {
  io.out('Usage: pwf <command> [options]')
  io.out('')
  for (const c of COMMANDS) io.out(`  ${c.name.padEnd(10)} ${c.summary}`)
  io.out('')
  io.out('Run `pwf <command> --help` for the options of one command.')
}

/** Runs one invocation and resolves to its exit code. */
export async function main(argv: readonly string[], io: CommandIO): Promise<number> {
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
