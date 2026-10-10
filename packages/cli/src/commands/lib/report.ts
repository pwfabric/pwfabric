/**
 * Validation as the commands report it: the pack library's findings plus
 * the project's pins checked against its local cache.
 */
import { existsSync } from 'node:fs'
import { hashPack, validatePack, type PackFolder, type PackIssue, type PackValidation } from '@pwfabric/pack'
import type { CommandIO } from '../types.js'
import { cacheDir, cacheRelDir, readCachedPack } from './project.js'
import { pinsOf } from './identity.js'

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

/** `validatePack` plus {@link checkPins}, as one result. */
export async function validateProject(root: string, pack: PackFolder): Promise<PackValidation> {
  const result = validatePack(pack)
  const pinIssues = await checkPins(root, result.identity)
  const issues = [...result.issues, ...pinIssues]
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
