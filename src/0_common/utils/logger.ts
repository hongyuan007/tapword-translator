/**
 * Logger Utility
 *
 * Simple logging wrapper that provides:
 * 1. Consistent log format with module prefixes
 * 2. Log level control (info, warn, error, debug)
 * 3. Easy replacement for console.log/console.error
 * 4. Production-ready with optional log level filtering
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LoggerConfig {
    /** Minimum log level to display */
    minLevel?: LogLevel
    /** Enable/disable logging globally */
    enabled?: boolean
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
}

class Logger {
    private config: LoggerConfig = {
        minLevel: "debug",
        enabled: true,
    }
    private readonly startMonotonicMs: number
    private activeToasts: HTMLElement[] = []
    private static readonly MAX_TOASTS = 5
    private static readonly TOAST_DURATION_MS = 5000

    constructor() {
        this.startMonotonicMs = this.getMonotonicNow()

        // Automatically configure logger based on environment variable
        const loggerEnabled = import.meta.env.VITE_LOGGER_ENABLED === "true"
        this.config.enabled = loggerEnabled
    }

    /**
     * Update logger configuration
     */
    configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config }
    }

    /**
     * Check if a log level should be displayed
     */
    private shouldLog(level: LogLevel): boolean {
        if (!this.config.enabled) {
            return false
        }
        const minLevel = this.config.minLevel || "debug"
        return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
    }

    /**
     * Safely serialize a single argument for logging.
     */
    private safeSerialize(arg: unknown): unknown {
        if (typeof arg === "bigint") {
            return arg.toString()
        }

        if (typeof arg === "object" && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2)
            } catch {
                try {
                    return String(arg)
                } catch {
                    return "[Unserializable value]"
                }
            }
        }

        return arg
    }

    /**
     * Format log message with prefix and serialize objects
     */
    private formatAndSerialize(prefix: string, ...args: unknown[]): unknown[] {
        const timestampPrefix = this.formatTimestampPrefix(prefix)
        const serializedArgs = args.map((arg) => this.safeSerialize(arg))
        return [timestampPrefix, ...serializedArgs]
    }

    private getMonotonicNow(): number {
        if (typeof performance !== "undefined" && typeof performance.now === "function") {
            return performance.now()
        }
        return Date.now()
    }

    private formatTimestampPrefix(prefix: string): string {
        const now = new Date()
        const hours = String(now.getHours()).padStart(2, "0")
        const minutes = String(now.getMinutes()).padStart(2, "0")
        const seconds = String(now.getSeconds()).padStart(2, "0")
        const milliseconds = String(now.getMilliseconds()).padStart(3, "0")
        const elapsedMs = Math.max(0, Math.round(this.getMonotonicNow() - this.startMonotonicMs))

        return `[${hours}:${minutes}:${seconds}.${milliseconds}][+${elapsedMs}ms][${prefix}]`
    }

    private fallbackLog(method: "log" | "warn" | "error", prefix: string, error: unknown): void {
        try {
            console[method](`[LoggerFallback][${prefix}] Logging failed`, error)
        } catch {}
    }

    private emit(level: LogLevel, method: "log" | "warn" | "error", prefix: string, ...args: unknown[]): void {
        if (!this.shouldLog(level)) {
            return
        }

        try {
            console[method](...this.formatAndSerialize(prefix, ...args))
        } catch (error) {
            this.fallbackLog(method, prefix, error)
        }

        // Dev alert for warn/error
        try {
            const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
            this.showDevAlert(level, prefix, message)
        } catch {}
    }

    /**
     * Show a non-blocking floating toast in the browser for warn/error logs.
     * Only active in dev mode (VITE_LOGGER_ENABLED === "true") and DOM-capable contexts.
     */
    private showDevAlert(level: LogLevel, prefix: string, message: string): void {
        if (!this.config.enabled) return
        if (typeof document === "undefined") return
        if (level !== "warn" && level !== "error") return
        if (this.activeToasts.length >= Logger.MAX_TOASTS) return

        try {
            const bgColor = level === "error" ? "#dc3545" : "#fd7e14"
            const bottomOffset = 16 + this.activeToasts.length * 64

            const toast = document.createElement("div")
            toast.style.cssText = `position:fixed;bottom:${bottomOffset}px;right:16px;z-index:2147483647;max-width:500px;padding:12px 16px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;background:${bgColor};opacity:0.95;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);word-break:break-all;transition:opacity 0.3s ease;`

            const truncMsg = message.length > 200 ? message.substring(0, 200) + "..." : message
            toast.innerHTML = `<strong>[${level.toUpperCase()}]</strong> [${this.escapeHtml(prefix)}] ${this.escapeHtml(truncMsg)}`

            document.body.appendChild(toast)
            this.activeToasts.push(toast)

            setTimeout(() => {
                toast.style.opacity = "0"
                setTimeout(() => {
                    toast.remove()
                    this.activeToasts = this.activeToasts.filter((t) => t !== toast)
                }, 300)
            }, Logger.TOAST_DURATION_MS)
        } catch {}
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }

    /**
     * Debug level log (lowest priority)
     */
    debug(prefix: string, ...args: unknown[]): void {
        this.emit("debug", "log", prefix, ...args)
    }

    /**
     * Info level log (general information)
     */
    info(prefix: string, ...args: unknown[]): void {
        this.emit("info", "log", prefix, ...args)
    }

    /**
     * Warning level log
     */
    warn(prefix: string, ...args: unknown[]): void {
        this.emit("warn", "warn", prefix, ...args)
    }

    /**
     * Error level log (highest priority)
     */
    error(prefix: string, ...args: unknown[]): void {
        this.emit("error", "error", prefix, ...args)
    }
}

// Singleton instance
const logger = new Logger()

/**
 * Configure the global logger
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
    logger.configure(config)
}

/**
 * Create a module-specific logger with automatic prefix
 */
export function createLogger(moduleName: string) {
    return {
        debug: (...args: unknown[]) => logger.debug(moduleName, ...args),
        info: (...args: unknown[]) => logger.info(moduleName, ...args),
        warn: (...args: unknown[]) => logger.warn(moduleName, ...args),
        error: (...args: unknown[]) => logger.error(moduleName, ...args),
    }
}

/**
 * Direct access to logger methods (for backward compatibility)
 */
export const log = {
    debug: (prefix: string, ...args: unknown[]) => logger.debug(prefix, ...args),
    info: (prefix: string, ...args: unknown[]) => logger.info(prefix, ...args),
    warn: (prefix: string, ...args: unknown[]) => logger.warn(prefix, ...args),
    error: (prefix: string, ...args: unknown[]) => logger.error(prefix, ...args),
}
