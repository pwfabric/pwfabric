/**
 * Validation as the commands report it: the pack library's findings plus
 * the project's pins checked against its local cache.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashPack, validatePack, type PackFolder, type PackIssue, type PackValidation } from '@pwfabric/pack'
import type { CommandIO } from '../types.js'
import { cacheDir, cacheRelDir, readCachedPack } from './project.js'
import { pinsOf } from './identity.js'
import { readEntities, readReceipt, readSeed, surfaceKeys } from '../../host/definitions.js'

/**
 * Checks every `packs[]` pin against `.pwf/packs/<id>@<version>/`.
 * A build that is not cached is a warning (`PIN_NOT_CACHED`: `pwf add` it);
 * a cached build whose content hash differs from the pin is an error
 * (`PIN_HASH_MISMATCH`).
 */
export async function checkPins(root: string, identity: PackValidation['identity']): Promise<PackIssue[]> {
  const issues: PackIssue[] = []
  for (const pin of pinsOf(identity)) {
    let dir: string
    try {
      dir = cacheDir(root, pin.id, pin.version)
    } catch (e) {
      issues.push({ severity: 'error', code: 'PIN_INVALID', path: 'pwpack.json', message: (e as Error).message })
      continue
    }
    const rel = cacheRelDir(pin.id, pin.version)
    if (!existsSync(dir)) {
      issues.push({
        severity: 'warning',
        code: 'PIN_NOT_CACHED',
        path: rel,
        message: `${pin.id}@${pin.version} is pinned but not in ${rel}; run \`pwf add <its .pwpack or folder>\``,
      })
      continue
    }
    const actual = hashPack(await readCachedPack(dir))
    if (actual !== pin.hash) {
      issues.push({
        severity: 'error',
        code: 'PIN_HASH_MISMATCH',
        path: rel,
        message: `${pin.id}@${pin.version} is pinned at ${pin.hash} but the cached build hashes ${actual}`,
      })
    }
  }
  return issues
}

/**
 * Reads every `app/data/<typeId>.json(l)` seed file with the same reader
 * `pwf dev` uses, so a file the dev host would reject is an error here
 * (`SEED_INVALID`) instead of a 500 on the first record request.
 */
export function checkSeeds(root: string): PackIssue[] {
  const dir = join(root, 'app', 'data')
  if (!existsSync(dir)) return []
  const issues: PackIssue[] = []
  const typeIds = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl?$/, '')),
  )
  for (const typeId of typeIds) {
    try {
      readSeed(root, typeId)
    } catch (e) {
      issues.push({ severity: 'error', code: 'SEED_INVALID', path: `app/data/${typeId}`, message: (e as Error).message })
    }
  }
  return issues
}

const ENTITIES_SHAPE = '{ "entities": [ { "typeId": "…", "fields": [ { "name": "…", "type": "text", "required": true } ] } ] }'

/**
 * `app/definitions/entities.json` as `pwf dev` reads it: an entry without a
 * `typeId`, or a field without a `name`, is dropped there without a word, and the
 * page that writes to it fails in the browser with "Entity type … is not
 * registered". Here each is an error (`ENTITY_INVALID`), and so is a page that
 * binds an entity type the file does not declare (`ENTITY_UNDECLARED`).
 */
export function checkEntities(root: string): PackIssue[] {
  const issues: PackIssue[] = []
  const path = 'app/definitions/entities.json'
  const file = join(root, path)
  if (existsSync(file)) {
    let raw: unknown
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
      return [{ severity: 'error', code: 'ENTITY_INVALID', path, message: `not valid JSON: ${(e as Error).message}` }]
    }
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { entities?: unknown }).entities)
      ? ((raw as { entities: unknown[] }).entities)
      : null
    if (!list) issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `must be ${ENTITIES_SHAPE}` })
    for (const [i, e] of (list ?? []).entries()) {
      const entry = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      if (typeof entry.typeId !== 'string' || !entry.typeId) {
        issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `entities[${i}] has no "typeId" (it has: ${Object.keys(entry).join(', ') || 'nothing'}); expected ${ENTITIES_SHAPE}` })
      }
      for (const [j, f] of (Array.isArray(entry.fields) ? entry.fields : []).entries()) {
        const field = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
        if (typeof field.name !== 'string' || !field.name) {
          issues.push({ severity: 'error', code: 'ENTITY_INVALID', path, message: `entities[${i}].fields[${j}] has no "name" (it has: ${Object.keys(field).join(', ') || 'nothing'})` })
        }
      }
    }
  }
  const declared = new Set(readEntities(root).map((e) => e.typeId))
  for (const key of surfaceKeys(root)) {
    const used = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (!v || typeof v !== 'object') return
      for (const [k, x] of Object.entries(v)) {
        if (k === 'entityType' && typeof x === 'string' && x) used.add(x)
        else walk(x)
      }
    }
    try { walk(readReceipt(root, key)) } catch { continue }
    for (const type of used) {
      if (!declared.has(type)) {
        issues.push({ severity: 'error', code: 'ENTITY_UNDECLARED', path: `app/surfaces/${key}.receipt.json`, message: `uses entity type "${type}", which ${path} does not declare` })
      }
    }
  }
  return issues
}

/** `validatePack` plus {@link checkPins}, {@link checkSeeds} and {@link checkEntities}, as one result. */
export async function validateProject(root: string, pack: PackFolder): Promise<PackValidation> {
  const result = validatePack(pack)
  const pinIssues = await checkPins(root, result.identity)
  const issues = [...result.issues, ...pinIssues, ...checkSeeds(root), ...checkEntities(root)]
  return { ...result, issues, ok: !issues.some((i) => i.severity === 'error') }
}

const SEVERITIES = ['error', 'warning', 'info'] as const
const HEADINGS = { error: 'Errors', warning: 'Warnings', info: 'Notes' } as const

/** Prints issues grouped by severity, errors first. Prints nothing for an empty list. */
export function printIssues(io: CommandIO, issues: readonly PackIssue[]): void {
  for (const severity of SEVERITIES) {
    const group = issues.filter((i) => i.severity === severity)
    if (group.length === 0) continue
    const write = severity === 'error' ? io.err.bind(io) : io.out.bind(io)
    write(`${HEADINGS[severity]} (${group.length}):`)
    for (const issue of group) write(`  ${issue.code}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`)
  }
}

/** `n errors, n warnings` for a summary line. */
export function countLine(issues: readonly PackIssue[]): string {
  const n = (s: PackIssue['severity']): number => issues.filter((i) => i.severity === s).length
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
  return `${plural(n('error'), 'error')}, ${plural(n('warning'), 'warning')}`
}
