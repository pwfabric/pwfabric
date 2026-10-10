/**
 * Surface / Block Render Timing
 *
 * Tracks render durations for surfaces and blocks using
 * high-resolution timing. Maintains a bounded history of
 * render metrics for performance analysis.
 *
 * Uses `performance.now()` when available, falling back to
 * `Date.now()` for SSR environments.
 *
 * @module @pwfabric/runtime/perf
 */

// ============================================================
// TIMING UTILITY
// ============================================================

/**
 * Get the current high-resolution timestamp.
 *
 * Falls back to `Date.now()` when `performance` is not available (SSR).
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

// ============================================================
// TYPES
// ============================================================

/** Metrics for a single surface render cycle */
export interface RenderMetrics {
  /** Surface identifier */
  readonly surfaceId: string
  /** High-resolution render start time */
  readonly startTime: number
  /** High-resolution render end time */
  readonly endTime: number
  /** Render duration in milliseconds */
  readonly duration: number
  /** Number of blocks rendered */
  readonly blockCount: number
}

/** Configuration for the RenderTimer */
export interface RenderTimerConfig {
  /** Maximum number of entries to keep in history (default: 100) */
  maxEntries?: number
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_MAX_ENTRIES = 100

// ============================================================
// RENDER TIMER
// ============================================================

/** Active render tracking entry */
interface ActiveRender {
  readonly startTime: number
  readonly blockCount: number
}

/**
 * Tracks surface render timing with bounded history.
 *
 * Call `startRender` before a surface renders and `endRender`
 * when rendering completes. The timer records the duration and
 * maintains a history of recent render metrics.
 */
export class RenderTimer {
  private entries = new Map<string, ActiveRender>()
  private history: RenderMetrics[] = []
  private readonly maxEntries: number

  /**
   * @param config - Optional configuration
   */
  constructor(config?: RenderTimerConfig) {
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * Mark the start of a surface render.
   *
   * @param surfaceId - Unique identifier for the surface
   * @param blockCount - Number of blocks being rendered (default: 0)
   */
  startRender(surfaceId: string, blockCount = 0): void {
    this.entries.set(surfaceId, {
      startTime: now(),
      blockCount,
    })
  }

  /**
   * Mark the end of a surface render and record metrics.
   *
   * @param surfaceId - The surface identifier passed to `startRender`
   * @returns The render metrics, or `undefined` if no matching start was found
   */
  endRender(surfaceId: string): RenderMetrics | undefined {
    const entry = this.entries.get(surfaceId)
    if (!entry) {
      return undefined
    }

    this.entries.delete(surfaceId)

    const endTime = now()
    const metrics: RenderMetrics = {
      surfaceId,
      startTime: entry.startTime,
      endTime,
      duration: endTime - entry.startTime,
      blockCount: entry.blockCount,
    }

    this.history.push(metrics)

    // Enforce bounded history
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(-this.maxEntries)
    }

    return metrics
  }

  /**
   * Calculate the average render time across all recorded renders.
   *
   * @returns Average duration in milliseconds, or 0 if no renders recorded
   */
  getAverageRenderTime(): number {
    if (this.history.length === 0) {
      return 0
    }
    const total = this.history.reduce((sum, m) => sum + m.duration, 0)
    return total / this.history.length
  }

  /**
   * Get the full render history.
   *
   * @returns Readonly array of render metrics
   */
  getHistory(): readonly RenderMetrics[] {
    return this.history
  }

  /**
   * Get the slowest renders, sorted by duration descending.
   *
   * @param count - Number of entries to return (default: 5)
   * @returns Array of the slowest render metrics
   */
  getSlowest(count = 5): RenderMetrics[] {
    return [...this.history].sort((a, b) => b.duration - a.duration).slice(0, count)
  }

  /**
   * Clear all history and active entries.
   */
  clear(): void {
    this.entries.clear()
    this.history = []
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a new RenderTimer instance.
 *
 * @param config - Optional configuration
 * @returns A new RenderTimer
 */
export function createRenderTimer(config?: RenderTimerConfig): RenderTimer {
  return new RenderTimer(config)
}
