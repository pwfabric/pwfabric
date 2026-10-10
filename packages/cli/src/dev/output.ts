/**
 * Writing an assembled pwapp to disk.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Thrown when the output folder holds something that is not a previous build. */
export class OutputFolderError extends Error {}

/**
 * Writes `files` into `outDir`, replacing a previous build there. A folder
 * that exists, is not empty and holds no `publish.json` is not a build this
 * command wrote, and is left alone.
 */
export async function writePwapp(files: ReadonlyMap<string, Uint8Array>, outDir: string): Promise<void> {
  const st = await stat(outDir).catch(() => null)
  if (st) {
    if (!st.isDirectory()) throw new OutputFolderError(`${outDir} exists and is not a folder`)
    const entries = await readdir(outDir)
    if (entries.length > 0 && !entries.includes('publish.json')) {
      throw new OutputFolderError(`${outDir} is not empty and holds no previous build (no publish.json); choose another --out`)
    }
    await rm(outDir, { recursive: true, force: true })
  }
  await mkdir(outDir, { recursive: true })
  for (const [path, bytes] of files) {
    const target = join(outDir, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}
