import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("retryWithBackoff")

/** Maximum number of retry attempts for transient errors. */
const MAX_RETRIES = 3
/** Base delay in milliseconds between retries (exponential: 2s, 4s, 8s). */
const BASE_DELAY_MS = 2000

/**
 * Check if an error is transient (retryable): 429 rate limit or network error.
 * Non-transient errors (401, 403, etc.) should NOT be retried.
 */
function isTransientError(error: unknown): boolean {
    // Network errors (TypeError from fetch)
    if (error instanceof TypeError) return true

    // HTTP status-based errors
    if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status: number }).status
        return status === 429 || status === 502 || status === 503 || status === 504
    }

    // Connection errors in error message
    if (error instanceof Error) {
        const msg = error.message.toLowerCase()
        return msg.includes("network") || msg.includes("connection") || msg.includes("econnreset")
    }

    return false
}

/**
 * Execute an async function with exponential backoff retry for transient errors.
 * Non-transient errors are thrown immediately without retry.
 *
 * @param label - Descriptive label for log messages (e.g., "AgentLoop", "SubagentRunner")
 * @param fn - The async function to execute
 * @returns The result of the function
 */
export async function retryWithBackoff<T>(
    label: string,
    fn: () => Promise<T>,
): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error

            if (!isTransientError(error) || attempt === MAX_RETRIES) {
                throw error
            }

            const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
            logger.warn(
                `[${label}] Transient error, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
                error instanceof Error ? error.message : String(error),
            )
            await sleep(delayMs)
        }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
