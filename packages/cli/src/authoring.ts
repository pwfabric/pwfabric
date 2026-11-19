/**
 * `@pwfabric/cli/authoring` — the functions behind the authoring commands,
 * for a tool that scaffolds and packs packs without running the pwf binary.
 *
 * Light on purpose: it reaches `@pwfabric/pack` and Node's file system, never
 * the dev server, the compiler or the runner, so it bundles into a
 * self-contained tool.
 *
 *   createPack   `pwf create --pack`: an empty canonical pack folder
 *   addBlock     `pwf add block`: a block's manifest.json and component.tsx
 *   readProject  a folder as `pwf validate` and `pwf pack` read it
 *
 * A bundled caller passes `engineVersion` to `createPack`: the default reads
 * the installed `@pwfabric/contracts` package, which a bundle does not carry.
 */
export { UsageError } from './commands/lib/flags.js'
export { readProject } from './commands/lib/project.js'
export {
  addBlock,
  blockComponent,
  blockManifest,
  createPack,
  PACK_ID,
  scaffoldNameProblem,
  type AddBlockOptions,
  type AddedBlock,
  type CreatedPack,
  type CreatePackOptions,
} from './commands/lib/scaffold.js'
