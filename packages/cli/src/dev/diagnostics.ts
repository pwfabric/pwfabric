/**
 * What an assembly says about the folder it read: one shape for compiler
 * output, validation findings and the assembler's own checks, so the terminal
 * and the overlay page print the same list.
 */

export type AssembleSeverity = 'error' | 'warning' | 'info'

export interface AssembleDiagnostic {
  readonly severity: AssembleSeverity
  /** Machine-readable reason, e.g. `PACK_NOT_CACHED` or a compiler code. */
  readonly code: string
  readonly message: string
  /** The file the finding is about, relative to the app folder when it can be. */
  readonly path?: string
  readonly line?: number
  readonly column?: number
}

/** `error  app/surfaces/home.receipt.json:3:7  UNKNOWN_BLOCK_TYPE  …` */
export function formatDiagnostic(d: AssembleDiagnostic): string {
  const where = d.path ? `${d.path}${d.line !== undefined ? `:${d.line}${d.column !== undefined ? `:${d.column}` : ''}` : ''}  ` : ''
  return `${d.severity.padEnd(7)} ${where}${d.code}  ${d.message}`
}

export function hasErrors(diagnostics: readonly AssembleDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

/** Errors first, then warnings, then info; stable within a severity. */
export function sortDiagnostics(diagnostics: readonly AssembleDiagnostic[]): AssembleDiagnostic[] {
  const rank: Record<AssembleSeverity, number> = { error: 0, warning: 1, info: 2 }
  return diagnostics
    .map((d, i) => [d, i] as const)
    .sort((a, b) => rank[a[0].severity] - rank[b[0].severity] || a[1] - b[1])
    .map(([d]) => d)
}
