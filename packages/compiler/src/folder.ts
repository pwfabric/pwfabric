/**
 * compileFolder — a convenience for a source tree that lives on disk.
 *
 * Reads every file under `dir` into memory (skipping `node_modules`, `dist`
 * and dot-directories), then hands the map to {@link compileAtom}. Reading is
 * the only disk access; compilation itself stays in memory. A pack reader that
 * already holds the tree should call `compileAtom` directly.
 *
 * @module @pwfabric/compiler/folder
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { compileAtom, type CompileInput, type CompileResult } from './compile.js'

const SKIP_DIRS = new Set(['node_modules', 'dist'])

/** Read a directory into a `files` map keyed by POSIX path relative to `dir`. */
export async function readSourceTree(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      const full = join(current, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
        await walk(full)
      } else if (e.isFile()) {
        files[relative(dir, full).split(sep).join('/')] = await readFile(full)
      }
    }
  }
  await walk(dir)
  return files
}

/** Compile the atom whose entry is `entry` (relative to `dir`) from the tree under `dir`. */
export async function compileFolder(
  dir: string,
  entry: string,
  options: Omit<CompileInput, 'files' | 'entry'> = {}
): Promise<CompileResult> {
  return compileAtom({ ...options, files: await readSourceTree(dir), entry })
}
