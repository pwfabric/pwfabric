/**
 * A failure a command reports as such — not a crash. It carries a stable
 * code, so a caller other than the terminal (`pwf mcp`) can say what went
 * wrong and how to fix it without parsing the printed text.
 */
import type { PackIssue } from '@pwfabric/pack'

export interface CommandFailureOptions {
  /** The findings behind the failure (validation issues), printed after the message. */
  readonly issues?: readonly PackIssue[]
  /** Print the findings before the message instead of after it. */
  readonly issuesFirst?: boolean
  /** The exact lines the terminal prints instead of `pwf <command>: <message>`. */
  readonly lines?: readonly string[]
}

export class CommandFailure extends Error {
  readonly code: string
  readonly issues: readonly PackIssue[]
  readonly issuesFirst: boolean
  readonly lines: readonly string[] | undefined

  constructor(code: string, message: string, options: CommandFailureOptions = {}) {
    super(message)
    this.name = 'CommandFailure'
    this.code = code
    this.issues = options.issues ?? []
    this.issuesFirst = options.issuesFirst === true
    this.lines = options.lines
  }
}
