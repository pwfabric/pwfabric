/**
 * Watching an app folder for changes.
 *
 * `fs.watch` with `recursive: true` where the platform supports it (Windows,
 * macOS, Linux on current Node); a polling walk where it does not. Either way
 * the caller sees one debounced callback per burst of changes, and changes in
 * the build's own output (`.pwf/build-cache`, `.pwf/out`), version control
 * and dependencies are ignored. The pack cache (`.pwf/packs`) is watched:
 * adding a pack is a change the app should pick up.
 */
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export type WatchMode = 'auto' | 'native' | 'poll'

export interface WatchOptions {
  /** Default `auto`: native recursive watching, polling when it is unavailable. */
  readonly mode?: WatchMode
  /** Quiet period before the callback fires. Default 150 ms. */
  readonly debounceMs?: number
  /** Poll interval in `poll` mode. Default 500 ms. */
  readonly pollMs?: number
}

export interface Watcher {
  /** `native` or `poll` — what is actually running. */
  readonly mode: 'native' | 'poll'
  close(): void
}

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist'])
const IGNORED_PREFIXES = ['.pwf/build-cache', '.pwf/out']

/** Whether a change at `rel` (POSIX, relative to the root) should trigger a rebuild. */
export function isWatchedPath(rel: string): boolean {
  const p = rel.split(sep).join('/').replace(/^\.\//, '')
  if (!p) return true
  if (IGNORED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return false
  return !p.split('/').some((s) => IGNORED_SEGMENTS.has(s))
}

/** A function that runs `fn` once `ms` after the last call. */
export function debounce(fn: () => void, ms: number): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
  run.cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return run
}

/** A signature of every watched file (path, size, mtime), for polling. */
export async function snapshot(root: string): Promise<string> {
  const parts: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full)
      if (!isWatchedPath(rel)) continue
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) {
        const st = await stat(full).catch(() => null)
        if (st) parts.push(`${rel}|${st.size}|${st.mtimeMs}`)
      }
    }
  }
  await walk(root)
  return parts.sort().join('\n')
}

function startPolling(root: string, onChange: () => void, pollMs: number): Watcher {
  let last: string | null = null
  let closed = false
  let running = false
  const tick = async (): Promise<void> => {
    if (running || closed) return
    running = true
    try {
      const now = await snapshot(root)
      if (last !== null && now !== last && !closed) onChange()
      last = now
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), pollMs)
  return {
    mode: 'poll',
    close() {
      closed = true
      clearInterval(timer)
    },
  }
}

/**
 * Watches `root` and calls `onChange` after each debounced burst of relevant
 * changes, with the POSIX paths that changed — or `null` when the platform
 * could not say (polling, or an event without a file name).
 */
export function watchFolder(root: string, onChange: (paths: string[] | null) => void, options: WatchOptions = {}): Watcher {
  let changed: Set<string> | null = new Set()
  const fire = debounce(() => {
    const paths = changed ? [...changed].sort() : null
    changed = new Set()
    onChange(paths)
  }, options.debounceMs ?? 150)
  const note = (path: string | null): void => {
    if (path === null) changed = null
    else changed?.add(path.split(sep).join('/'))
    fire()
  }
  const mode = options.mode ?? 'auto'
  if (mode !== 'poll') {
    let watcher: FSWatcher | null = null
    try {
      watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
        if (filename === null) note(null)
        else if (isWatchedPath(String(filename))) note(String(filename))
      })
    } catch (e) {
      if (mode === 'native') throw e
    }
    if (watcher) {
      const w = watcher
      // A watcher that dies (the folder is removed, the platform gives up)
      // must not take the server down; the next edit simply is not seen.
      w.on('error', () => undefined)
      return {
        mode: 'native',
        close() {
          fire.cancel()
          w.close()
        },
      }
    }
  }
  const poller = startPolling(root, () => note(null), options.pollMs ?? 500)
  return {
    mode: 'poll',
    close() {
      fire.cancel()
      poller.close()
    },
  }
}
