/**
 * Whether an app needs a local host: it declares sign-in
 * (`app/definitions/auth.json`) or records (`app/definitions/entities.json`).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from './sources.js'

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown
  } catch {
    return undefined
  }
}

/** What the app declares that only a host can serve. Empty when it needs none. */
export async function hostNeeds(root: string): Promise<string[]> {
  const needs: string[] = []
  const auth = await readJson(join(root, 'app', 'definitions', 'auth.json'))
  if (
    isRecord(auth) &&
    (auth['required'] === true ||
      auth['topology'] === 'external' ||
      (Array.isArray(auth['methods']) && auth['methods'].length > 0))
  ) {
    needs.push('sign-in')
  }
  const entities = await readJson(join(root, 'app', 'definitions', 'entities.json'))
  if (isRecord(entities) && Array.isArray(entities['entities']) && entities['entities'].length > 0) {
    needs.push('records')
  }
  return needs
}
