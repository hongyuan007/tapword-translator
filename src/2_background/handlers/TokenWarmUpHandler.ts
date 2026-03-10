/**
 * Token Warm-Up Handler
 *
 * Handles PAGE_ACTIVATED messages from content scripts.
 * Proactively fetches a JWT token before the user's first translation request.
 */

import * as loggerModule from "@/0_common/utils/logger"
import { getAuthService } from "@/5_backend"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("TokenWarmUpHandler")

/**
 * Handle PAGE_ACTIVATED message from content script.
 * Proactively ensures a valid JWT token is cached.
 * Fire-and-forget from the content script side — no response payload needed.
 */
export async function handlePageActivated(sendResponse: (response: { status: string }) => void): Promise<void> {
    sendResponse({ status: "warming" })

    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const authService = getAuthService()
        await authService.getToken()
        logger.debug("Token pre-warm completed")
    } catch (error) {
        // Warm-up errors are non-fatal — the actual translate request will retry
        logger.warn("Token pre-warm failed (non-fatal):", error)
    }
}
