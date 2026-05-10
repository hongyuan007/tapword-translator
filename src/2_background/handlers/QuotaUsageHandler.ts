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
import * as storageManagerModule from "@/0_common/utils/storageManager"

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

        const settings = await storageManagerModule.getUserSettings()
        const isOfficialProvider = settings.translationProvider === "official"

        logger.debug("Quota usage request handled:", usage)

        sendResponse({
            success: true,
            data: {
                fullTextTranslation: usage,
                isOfficialProvider,
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
