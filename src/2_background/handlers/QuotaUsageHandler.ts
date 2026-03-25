/**
 * Quota Usage Request Handler
 *
 * Handles quota usage queries from popup or content scripts.
 * Returns current full-text translation quota usage from local cache.
 */

import type { QuotaUsageResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { getQuotaManager } from "@/5_backend/services/QuotaManager"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("QuotaUsageHandler")

/**
 * Handle quota usage request.
 * Returns cached quota usage data for display in popup UI.
 */
export async function handleQuotaUsageRequest(
    sendResponse: (response: QuotaUsageResponseMessage) => void,
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()

        const quotaManager = getQuotaManager()
        const usage = await quotaManager.getFullTextTranslationQuotaUsage()

        logger.debug("Quota usage request handled:", usage)

        sendResponse({
            success: true,
            data: {
                fullTextTranslation: usage,
            },
        })
    } catch (error) {
        logger.error("Failed to get quota usage:", error)
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
