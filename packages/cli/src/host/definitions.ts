/**
 * What the local host reads from the pwpack folder.
 *
 *   app/definitions/auth.json      who may enter (definitions.md, `auth.json`)
 *   app/definitions/entities.json  the collections the host keeps
 *   app/surfaces/<key>.receipt.json  the pages it serves
 *   app/content/<typeId>.json      the app's shipped records (data-protocol §6)
 *   app/data/<typeId>.jsonl | .json  development records, never published
 *
 * Read on every call, never cached: `pwf dev` edits these files while the
 * host runs, and a definition change must apply without a restart. An absent
 * file is "not declared"; an unreadable one is reported as an error rather
 * than guessed around.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AuthDeclaration {
  readonly required: boolean
  readonly topology: 'app' | 'external'
  readonly methods: readonly string[]
  readonly issuer?: {
    readonly issuer: string
    readonly clientId: string
    readonly scopes: readonly string[]
    readonly audience?: string
  }
  readonly access: {
    readonly roles: readonly string[]
    readonly rules: readonly { readonly subject: string; readonly model: string; readonly rule: string }[]
  }
}

export interface EntityField {
  readonly name: string
  readonly type: string
  readonly required: boolean
}

export interface EntityDeclaration {
  readonly typeId: string
  readonly displayName?: string
  readonly fields: readonly EntityField[]
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text) as unknown
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** `undefined` when the app declares no `auth.json` (or an empty one). */
export function readAuth(root: string): AuthDeclaration | undefined {
  const raw = readJson(join(root, 'app', 'definitions', 'auth.json'))
  if (!isObject(raw) || Object.keys(raw).length === 0) return undefined
  const topology = raw.topology === 'external' ? 'external' : 'app'
  const iss = isObject(raw.issuer) ? raw.issuer : undefined
  const access = isObject(raw.access) ? raw.access : {}
  const rules = (Array.isArray(access.rules) ? access.rules : [])
    .filter(isObject)
    .map((r) => ({ subject: String(r.subject ?? ''), model: String(r.model ?? ''), rule: String(r.rule ?? '') }))
  return {
    required: raw.required === true,
    topology,
    methods: strings(raw.methods),
    ...(iss && typeof iss.issuer === 'string' && typeof iss.clientId === 'string'
      ? {
          issuer: {
            issuer: iss.issuer,
            clientId: iss.clientId,
            scopes: Array.isArray(iss.scopes) ? strings(iss.scopes) : ['openid', 'profile', 'email'],
            ...(typeof iss.audience === 'string' && iss.audience ? { audience: iss.audience } : {}),
          },
        }
      : {}),
    access: { roles: strings(access.roles), rules },
  }
}

export function readEntities(root: string): EntityDeclaration[] {
  const raw = readJson(join(root, 'app', 'definitions', 'entities.json'))
  const list = isObject(raw) && Array.isArray(raw.entities) ? raw.entities : []
  return list.filter(isObject).flatMap((e) => {
    if (typeof e.typeId !== 'string' || !e.typeId) return []
    const fields = (Array.isArray(e.fields) ? e.fields : []).filter(isObject).flatMap((f) =>
      typeof f.name === 'string' && f.name
        ? [{ name: f.name, type: typeof f.type === 'string' ? f.type : 'text', required: f.required === true }]
        : []
    )
    return [
      {
        typeId: e.typeId,
        ...(typeof e.displayName === 'string' ? { displayName: e.displayName } : {}),
        fields,
      },
    ]
  })
}

/** A page key is a file name, never a path. */
export const PAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function surfaceKeys(root: string): string[] {
  const dir = join(root, 'app', 'surfaces')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.receipt.json'))
    .map((f) => f.slice(0, -'.receipt.json'.length))
    .filter((k) => PAGE_KEY.test(k))
    .sort()
}

export function readReceipt(root: string, key: string): Record<string, unknown> | undefined {
  if (!PAGE_KEY.test(key)) return undefined
  const raw = readJson(join(root, 'app', 'surfaces', `${key}.receipt.json`))
  return isObject(raw) ? raw : undefined
}

/**
 * Seed rows for one collection: the app's content, then its development data.
 *
 * Two folders, one shape (data-protocol §6):
 *  - `app/content/<typeId>.json` — records the app ships for every visitor; a
 *    publisher inserts each one the record store does not hold yet.
 *  - `app/data/<typeId>.json` — development and test records; never published.
 * A data row with the id of a content row replaces it here, so a developer can
 * try a variant without editing the content.
 */
export function readSeed(root: string, typeId: string): Record<string, unknown>[] {
  if (!PAGE_KEY.test(typeId)) return []
  const rows = new Map<string, Record<string, unknown>>()
  let anonymous = 0
  for (const row of [...readRecordsFile(join(root, 'app', 'content'), typeId), ...readRecordsFile(join(root, 'app', 'data'), typeId)]) {
    const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : `\0${anonymous++}`
    rows.set(id, row)
  }
  return [...rows.values()]
}

/**
 * `<dir>/<typeId>.json` holding `{ "data": [ …records ] }` — the same `data`
 * envelope a record list answer uses. A record may carry its own `id`;
 * `createdAt`/`updatedAt` are filled when absent. Also accepted, for
 * hand-written files only: `<dir>/<typeId>.jsonl`, one JSON object per line
 * (blank lines skipped), read when no `.json` file exists.
 */
function readRecordsFile(dir: string, typeId: string): Record<string, unknown>[] {
  const jsonPath = join(dir, `${typeId}.json`)
  const json = readJson(jsonPath)
  if (json !== undefined) {
    if (!isObject(json) || !Array.isArray(json.data)) {
      throw new Error(`${jsonPath} must be { "data": [ ...records ] }`)
    }
    return json.data.filter(isObject)
  }
  const jsonl = join(dir, `${typeId}.jsonl`)
  if (!existsSync(jsonl)) return []
  return readFileSync(jsonl, 'utf8')
    .split(/\r?\n/)
    .map((line, i) => [line.trim(), i + 1] as const)
    .filter(([line]) => line !== '')
    .map(([line, n]) => {
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        throw new Error(`${jsonl}:${n} is not valid JSON`)
      }
      if (!isObject(row)) throw new Error(`${jsonl}:${n} is not a JSON object`)
      return row
    })
}
