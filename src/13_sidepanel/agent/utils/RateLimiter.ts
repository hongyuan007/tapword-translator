import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("RateLimiter")

/** Public API for rate limiting outgoing requests. */
export interface IRateLimiter {
    /**
     * Acquire a token. Resolves immediately if a token is available,
     * otherwise waits until one becomes available.
     * @param signal - Optional AbortSignal to cancel the wait.
     */
    acquire(signal?: AbortSignal): Promise<void>
}

/**
 * Token bucket rate limiter.
 * Tokens refill continuously based on elapsed time, not on a fixed interval.
 */
export class RateLimiter implements IRateLimiter {
    private tokens: number
    private readonly maxTokens: number
    /** Tokens added per second. */
    private readonly refillRate: number
    /** Timestamp (ms) of the last token refill calculation. */
    private lastRefillTime: number

    constructor(maxTokens: number, refillRate: number) {
        this.maxTokens = maxTokens
        this.refillRate = refillRate
        this.tokens = maxTokens
        this.lastRefillTime = Date.now()
    }

    async acquire(signal?: AbortSignal): Promise<void> {
        // Bail out immediately if already aborted
        if (signal?.aborted) {
            throw signal.reason ?? new DOMException("Aborted", "AbortError")
        }

        this.refill()

        if (this.tokens >= 1) {
            this.tokens -= 1
            return
        }

        // Calculate wait time until one token is available
        const deficit = 1 - this.tokens
        const waitMs = (deficit / this.refillRate) * 1000
        logger.info(`Throttling request — waiting ${Math.round(waitMs)}ms for token`)

        await this.waitWithAbort(waitMs, signal)

        // Refill again after sleeping, then consume
        this.refill()
        this.tokens = Math.max(0, this.tokens - 1)
    }

    /** Refill tokens based on elapsed time since last refill. */
    private refill(): void {
        const now = Date.now()
        const elapsed = (now - this.lastRefillTime) / 1000
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
        this.lastRefillTime = now
    }

    /** Sleep for the given duration, rejecting early if the signal fires. */
    private waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
                return
            }

            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort)
                resolve()
            }, ms)

            const onAbort = () => {
                clearTimeout(timer)
                reject(signal!.reason ?? new DOMException("Aborted", "AbortError"))
            }

            signal?.addEventListener("abort", onAbort, { once: true })
        })
    }
}

/** Shared singleton for LLM API rate limiting (2 tokens max, 2 tokens/sec). */
export const llmRateLimiter = new RateLimiter(2, 2)
