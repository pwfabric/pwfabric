/**
 * Logger Interface
 *
 * Structured logging interface for observability
 *
 * @module @pwfabric/core/observability/logger
 */

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Log context
 */
export interface LogContext {
  readonly traceId?: string
  readonly [key: string]: unknown
}

/**
 * Structured log entry
 */
export interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  readonly timestamp: string
  readonly name: string
  readonly context?: LogContext
}

/**
 * Logger interface
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  child(name: string): ILogger
}

/**
 * Log level priority
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Environment detection
 */
function isProduction(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'production'
  }
  return false
}

/**
 * Console logger implementation
 *
 * In development: human-readable format
 * In production: structured JSON format
 */
export class ConsoleLogger implements ILogger {
  private readonly name: string
  private readonly minLevel: LogLevel
  private readonly production: boolean

  constructor(name: string, minLevel: LogLevel = 'info') {
    this.name = name
    this.minLevel = minLevel
    this.production = isProduction()
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel]
  }

  private formatEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      name: this.name,
      ...(context && { context }),
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return

    const entry = this.formatEntry(level, message, context)

    if (this.production) {
      // Production: structured JSON
      const output = JSON.stringify(entry)
      if (level === 'error') {
        console.error(output)
      } else if (level === 'warn') {
        console.warn(output)
      } else {
        console.log(output)
      }
    } else {
      // Development: human-readable
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.name}]`
      const output = `${prefix} ${message}`

      if (level === 'error') {
        console.error(output, context ?? '')
      } else if (level === 'warn') {
        console.warn(output, context ?? '')
      } else {
        console.log(output, context ?? '')
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context)
  }

  child(name: string): ILogger {
    return new ConsoleLogger(`${this.name}:${name}`, this.minLevel)
  }
}

/**
 * Create a logger instance
 */
export function createObservabilityLogger(name: string, minLevel?: LogLevel): ILogger {
  return new ConsoleLogger(name, minLevel)
}
