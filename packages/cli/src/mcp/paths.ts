/**
 * The paths an MCP tool is given. A tool call carries no working directory a
 * model can rely on (each client starts the server somewhere else), so every
 * tool names its project folder absolutely, and nothing is written outside it.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { CommandFailure } from '../commands/lib/failure.js'

/** The project folder: an absolute path, normalised. */
export function projectDirOf(path: string): string {
  if (!isAbsolute(path)) {
    throw new CommandFailure('PATH_NOT_ABSOLUTE', `projectDir must be an absolute path, got "${path}"`)
  }
  return resolve(path)
}

/** Whether `path` (absolute) is `root` or inside it. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * A path the tool writes: relative to the project folder or absolute, and in
 * either case inside it. `undefined` stays undefined (the command's default,
 * which is always inside the folder).
 */
export function writeTarget(root: string, path: string | undefined, what: string): string | undefined {
  if (path === undefined) return undefined
  const target = resolve(root, path)
  if (!isInside(root, target)) {
    throw new CommandFailure('PATH_OUTSIDE_PROJECT', `${what} "${path}" is outside the project folder ${root}; pwf mcp writes only inside it`)
  }
  return target
}

/** A path the tool only reads (a pack to install): relative to the project folder or absolute. */
export function readSource(root: string, path: string): string {
  return resolve(root, path)
}
