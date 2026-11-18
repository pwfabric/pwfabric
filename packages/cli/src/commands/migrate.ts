/**
 * `pwf migrate blocks [dir]` — moves each block's zod schema into its
 * manifest (engine 3.0: the manifest is the only definition of a block's
 * props, and no visitor page carries zod). See ./lib/migrate-blocks.ts.
 */
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { migrateBlocks } from './lib/migrate-blocks.js'

export async function runMigrate(args: ParsedArgs, io: CommandIO): Promise<number> {
  const what = args.positionals[0]
  if (what !== 'blocks') throw new UsageError(what === undefined ? 'missing what to migrate (blocks)' : `cannot migrate "${what}" (only: blocks)`)
  const root = resolveFrom(io.cwd, args.positionals[1])
  const check = boolFlag(args, 'check')
  const results = await migrateBlocks(root, !check)
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) {
      if (r.error) {
        io.out(`${r.dir}: ${r.error}`)
        continue
      }
      const verb = r.changed ? (check ? 'would change' : 'written') : 'agrees'
      io.out(`${r.dir}: ${verb} (schema ${r.schemaFrom}; ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'})`)
      for (const f of r.findings) io.out(`  ${f.kind}: ${f.message}`)
    }
  }
  const migrated = results.filter((r) => !r.error)
  const changed = migrated.filter((r) => r.changed).length
  io.out(`${results.length} blocks: ${migrated.length} with a schema, ${changed} ${check ? 'to change' : 'changed'}, ${results.length - migrated.length} without one`)
  io.out('Next: review each default and constraint finding, delete the zod import and the schema from each block, read props as the manifest gives them (defaults applied), and run `pwf validate`.')
  return check && changed > 0 ? 1 : 0
}

export const migrate: Command = {
  name: 'migrate',
  summary: "Move each block's zod schema into its manifest (engine 3.0)",
  usage: `pwf migrate blocks [dir] [--check] [--json]

  dir      a pack or app folder (default: the current folder); every block
           folder under it (a manifest.json of kind "block" beside its entry)
  --check  report only; exit 1 when a manifest would change
  --json   print the raw result per block

For each block, reads its props schema (the definition's schema, or the one
*PropsSchema export), its manifest's definition.props and the component's
literal fallbacks (props.x ?? <literal>, a destructuring default), reports
every disagreement (only-in-schema, only-in-manifest, type, default, enum,
required, constraint, type-string, unrepresentable) and writes the merged
definition.props. Before 3.0 the render never parsed props with the schema:
what drew for a missing prop was the code's fallback. So the shape comes from
the schema, the default from the code's literal fallback (else the manifest,
else the schema, reported), a constraint the render never enforced (format,
.int(), a bound, required) only where the manifest already had it, and
bindable, copy and description from the manifest; the type string is
regenerated when the shape changed under it. Only module-level code of the
block runs: React and the engine are inert stand-ins.`,
  run: (args, io) => guard('migrate', io, () => runMigrate(args, io)),
}
