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
error. Every block in app/surfaces/*.receipt.json is checked
against its block's manifest (definition.props[].jsonSchema): an undeclared
prop (BLOCK_PROP_UNKNOWN), a value outside the prop's enum (BLOCK_PROP_ENUM)
or of the wrong JSON type (BLOCK_PROP_TYPE) is a warning; {{…}} bindings are
not checked, except that a {{…}} in a prop the manifest declares
bindable: false is a warning (BLOCK_PROP_NOT_BINDABLE): it renders as written.
A value of the right type that breaks the rest of its declared shape (a
bound, length, pattern, format, or a member of a nested object or array
item) is a warning too (BLOCK_PROP_SHAPE): the block gets it as written.
\`pwf build\` reports the same findings, so receipts are judged before they
ship, not in the visitor's browser.

The manifest is a block's only definition of its props (3.0). A source file
that imports zod is an error (BLOCK_IMPORTS_ZOD; \`pwf migrate blocks\` moves
the schema into the manifest), and a prop declaration the runtime cannot
read, or whose default does not fit it, is a warning (BLOCK_PROP_DECLARATION).

The app writes every word. MESSAGES_MISSING lists the runner message ids the
app can reach (its sign-in screen, account labels, not-found page …) that
app/plan.json messages does not set, and the ui.* words placed blocks read
of their own (each block manifest's definition.messages, unless the receipt
sets the prop that replaces the word, or turns off the part that reads it): an error, as the engine writes no
words of its own (the visitor would read nothing there). BLOCK_DEFAULT_COPY (warning): a placed block
shows its manifest's default for a copy prop the receipt does not set.
ERROR_BOUND_AS_TEXT (warning): a receipt shows {{__errors.*}} or a
statusKeys.reason/detail value as text instead of branching on it.
STATUS_KEY_UNKNOWN (warning): a statusKeys names a member the runtime never
writes (2.2's message). ENGINE_RANGE_EXCLUDED (error): the app or a pinned
pack declares an engines.pwfabric range this engine is not in; \`pwf build\`
refuses it too.
Exit code 1 when there is any error, 0 otherwise.`,
  run: (args, io) => guard('validate', io, () => runValidate(args, io)),
}
