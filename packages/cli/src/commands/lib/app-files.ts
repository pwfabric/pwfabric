/**
 * Reading and writing the app's own JSON files (`app/plan.json`,
 * `app/messages/<lang>.json`, receipts, media declarations) for the commands
 * that change an app folder: `pwf media add`, `pwf locale`, `pwf page add`,
 * `pwf records`. Every file is written as the other commands write theirs
 * (two-space JSON, trailing newline); a file that is not a JSON object is a
 * {@link CommandFailure} naming it, never a crash or a silent overwrite.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CommandFailure } from './failure.js'
import { formatJson, readIdentityFile, stripBom, type IdentityJson } from './identity.js'

export type JsonObject = Record<string, unknown>

export const PLAN_FILE = 'app/plan.json'
export const MESSAGES_DIR = 'app/messages'
export const SURFACES_DIR = 'app/surfaces'
export const RECEIPT_SUFFIX = '.receipt.json'

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The absolute path of a folder-relative path written with `/`. */
export function inFolder(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

/** A JSON object file, or `undefined` when there is none. Not JSON, or not an object: APP_FILE_INVALID. */
export async function readJsonObject(root: string, rel: string): Promise<JsonObject | undefined> {
  const text = await readFile(inFolder(root, rel), 'utf8').catch(() => null)
  if (text === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(stripBom(text))
  } catch (e) {
    throw new CommandFailure('APP_FILE_INVALID', `${rel} is not JSON: ${(e as Error).message}`)
  }
  if (!isObject(value)) throw new CommandFailure('APP_FILE_INVALID', `${rel} is not a JSON object`)
  return value
}

export async function writeJsonFile(root: string, rel: string, value: unknown): Promise<void> {
  const path = inFolder(root, rel)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, formatJson(value))
}

export function fileExists(root: string, rel: string): boolean {
  return existsSync(inFolder(root, rel))
}

/** The app's `pwpack.json` and its `app` member; a pack (no `app`) is NOT_AN_APP. */
export async function readAppIdentity(root: string, command: string): Promise<{ identity: IdentityJson; app: JsonObject }> {
  const identity = await readIdentityFile(root)
  const app = identity['app']
  if (!isObject(app)) throw new CommandFailure('NOT_AN_APP', `${command} changes an app, and ${root} is a pack (its pwpack.json has no "app")`)
  return { identity, app }
}

/** `app.surfaceOrder` as strings. */
export function surfaceOrderOf(app: JsonObject): string[] {
  return Array.isArray(app['surfaceOrder']) ? app['surfaceOrder'].filter((k): k is string => typeof k === 'string') : []
}

/** The receipt path of a page key: `app/surfaces/<key>.receipt.json`. */
export function receiptRel(key: string, lang?: string): string {
  return `${SURFACES_DIR}/${key}${lang ? `.${lang}` : ''}${RECEIPT_SUFFIX}`
}
