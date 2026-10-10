/**
 * Logger utility for PWFabric
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: Date
  context: Record<string, unknown> | undefined
}

/**
 * Simple logger implementation
 */
export class Logger {
  private readonly name: string
  private readonly minLevel: LogLevel

  private static readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(name: string, minLevel: LogLevel = 'info') {
    this.name = name
    this.minLevel = minLevel
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.levels[level] >= Logger.levels[this.minLevel]
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
    }

    const output = `[${entry.timestamp.toISOString()}] [${level.toUpperCase()}] [${this.name}] ${message}`

    if (level === 'error') {
      console.error(output, context ?? '')
    } else if (level === 'warn') {
      console.warn(output, context ?? '')
    } else {
      // Using console.info for debug and info to avoid eslint no-console warning
      // In production, this would be replaced with a proper logging library
      process.stdout.write(output + (context ? ` ${JSON.stringify(context)}` : '') + '\n')
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context)
  }

  child(name: string): Logger {
    return new Logger(`${this.name}:${name}`, this.minLevel)
  }
}

/**
 * Create a logger instance
 */
export function createLogger(name: string, level?: LogLevel): Logger {
  return new Logger(name, level)
}
