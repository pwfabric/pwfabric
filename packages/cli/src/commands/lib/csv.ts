/**
 * CSV as RFC 4180 writes it: fields split by `,`, records by CRLF (LF read
 * too), a field quoted with `"` when it holds a comma, a quote or a line
 * break, a quote inside a quoted field doubled. The first record is the
 * header.
 *
 * Spreadsheet formula guard: a text cell that starts with `=`, `+`, `-`,
 * `@`, a tab or a carriage return is run as a formula by a spreadsheet that
 * opens the file, so {@link writeCsv} writes it with a leading `'`, and
 * {@link unguard} takes that `'` off again on the way back in.
 */

/** Parses CSV text into records of fields. A quote left open is an error. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < src.length) {
    const c = src[i] as string
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i++
    } else if (c === ',') {
      endField()
      i++
    } else if (c === '\r' && src[i + 1] === '\n') {
      endRow()
      i += 2
    } else if (c === '\n' || c === '\r') {
      endRow()
      i++
    } else {
      field += c
      i++
    }
  }
  if (quoted) throw new Error('a quoted field is not closed')
  if (field !== '' || row.length > 0) endRow()
  return rows
}

const NEEDS_GUARD = /^[=+\-@\t\r]/

/** A text cell as written: guarded against formulas, quoted when it must be. */
export function csvField(value: string, guard = true): string {
  const v = guard && NEEDS_GUARD.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Writes records as CSV with CRLF line ends; `text[i][j]` false marks a cell that is not text (a number, a boolean) and is never guarded. */
export function writeCsv(header: readonly string[], rows: readonly (readonly string[])[], text?: readonly (readonly boolean[])[]): string {
  const lines = [header.map((h) => csvField(h)).join(',')]
  rows.forEach((r, i) => lines.push(r.map((cell, j) => csvField(cell, text?.[i]?.[j] !== false)).join(',')))
  return `${lines.join('\r\n')}\r\n`
}

/** A cell read back: the `'` {@link writeCsv} put before a formula-like text is taken off. */
export function unguard(cell: string): string {
  return cell.startsWith("'") && NEEDS_GUARD.test(cell.slice(1)) ? cell.slice(1) : cell
}
