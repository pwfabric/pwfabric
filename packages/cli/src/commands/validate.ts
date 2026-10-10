/**
 * `pwf validate [dir]` — checks a pwpack folder and its pinned packs.
 */
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard } from './lib/flags.js'
import { readProject, resolveFrom } from './lib/project.js'
import { countLine, printIssues, validateProject } from './lib/report.js'

export async function runValidate(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolveFrom(io.cwd, args.positionals[0])
  const result = await validateProject(root, await readProject(root))
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify(result, null, 2))
    return result.ok ? 0 : 1
  }
  const who = result.identity ? `${result.identity.id}@${result.identity.version}` : root
  printIssues(io, result.issues)
  const summary = `${who}: ${result.ok ? 'valid' : 'invalid'} (${countLine(result.issues)}; layout ${result.layout}; ${result.atoms.length} atoms)`
  if (result.ok) io.out(summary)
  else io.err(summary)
  return result.ok ? 0 : 1
}

export const validate: Command = {
  name: 'validate',
  summary: 'Check a pwpack folder and the packs it pins',
  usage: `pwf validate [dir] [--json]

  dir      the pwpack folder (default: the current folder)
  --json   print the raw result (ok, issues, identity, layout, atoms)

Every packs[] pin is looked up in .pwf/packs/<id>@<version>/: a build that is
not there is a warning, one whose content hash differs from the pin is an
error. Exit code 1 when there is any error, 0 otherwise.`,
  run: (args, io) => guard('validate', io, () => runValidate(args, io)),
}
