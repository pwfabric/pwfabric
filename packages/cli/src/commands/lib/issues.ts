/**
 * Printing validation findings: grouped by severity, errors to stderr.
 * Kept apart from ./report.ts so that `guard` (and through it the light
 * `@pwfabric/cli/authoring` entry) can print a failure's findings without
 * loading the validators.
 */
import type { PackIssue } from '@pwfabric/pack'
import type { CommandIO } from '../types.js'

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
