import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES = fileURLToPath(new URL('../../__fixtures__/', import.meta.url))
export const PACK_REL = ['.pwf', 'packs', '@pwpack', 'k', 'kit@1.0.0']

/** A temp copy of the k-app fixture with the k-pack fixture in its pack cache. */
export async function makeApp(options: { withPack?: boolean } = {}): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'pwf-k-'))
  await cp(join(FIXTURES, 'k-app'), root, { recursive: true })
  if (options.withPack !== false) await cp(join(FIXTURES, 'k-pack'), join(root, ...PACK_REL), { recursive: true })
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

export const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes)
export const parse = (bytes: Uint8Array | undefined): unknown => JSON.parse(text(bytes))
