/**
 * Token Warm-Up Handler
 *
 * Handles PAGE_ACTIVATED messages from content scripts.
 * Proactively fetches a JWT token before the user's first translation request.
 */

import * as loggerModule from "@/0_common/utils/logger"
import { getAuthService } from "@/5_backend"

const logger = loggerModule.createLogger("TokenWarmUpHandler")

/**
 * Handle PAGE_ACTIVATED message from content script.
 * Proactively ensures a valid JWT token is cached.
 * Fire-and-forget from the content script side — no response payload needed.
 */
export function handlePageActivated(sendResponse: (response: { status: string }) => void): void {
    const authService = getAuthService()

    if (!authService.isInitialized()) {
        logger.debug("AuthService not yet initialized, skipping warm-up")
        sendResponse({ status: "not_initialized" })
        return
    }

    // Non-blocking: kick off token prefetch but do not wait for it
    authService
        .getToken()
        .then(() => {
            logger.debug("Token pre-warm completed")
        })
        .catch((error) => {
            // Warm-up errors are non-fatal — the actual translate request will retry
            logger.warn("Token pre-warm failed (non-fatal):", error)
        })

    // Respond immediately; the actual fetch continues asynchronously
    sendResponse({ status: "warming" })
}
