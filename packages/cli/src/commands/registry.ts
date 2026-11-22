import type { Command } from './types.js'
import { create } from './create.js'
import { devCommand } from './dev.js'
import { buildCommand } from './build.js'
import { validate } from './validate.js'
import { pack } from './pack.js'
import { add } from './add.js'
import { run } from './run.js'
import { migrate } from './migrate.js'
import { mcpCommand } from './mcp.js'
import { loginCommand, logoutCommand, whoamiCommand } from './login.js'
import { publish } from './publish.js'
import { EXTRA_COMMANDS } from './registry-extra.js'

/**
 * Every `pwf` command. Lanes add their command module here and nowhere else.
 * Order is the order `pwf help` prints.
 */
export const COMMANDS: Command[] = [create, devCommand, buildCommand, validate, pack, add, run, migrate, mcpCommand, publish, loginCommand, logoutCommand, whoamiCommand]
COMMANDS.push(...EXTRA_COMMANDS)

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name)
}
