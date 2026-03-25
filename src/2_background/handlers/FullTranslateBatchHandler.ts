/**
 * Full-Page Batch Translation Request Handler
 *
 * Handles batch translation requests from content script.
 * Uses the dedicated full-text-batch endpoint for LLM-level batching.
 * Extracts quota info from successful responses and handles quota exceeded errors.
 */

import type { FullTranslateBatchRequestData, FullTranslateBatchResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { APIError, APIErrorCodes, post } from "@/5_backend"
import { getQuotaManager } from "@/5_backend/services/QuotaManager"
import { TRANSLATION_API_ENDPOINTS } from "@/6_translate/constants/TranslationConstants"
import type { FullTextBatchApiRequest, FullTextBatchApiResponse } from "@/6_translate/types/TranslationApiTypes"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("FullTranslateBatchHandler")

/**
 * Handle batch translation request from content script.
 * Calls the dedicated full-text-batch endpoint (single LLM call for all texts).
 */
export async function handleFullTranslateBatchRequest(
    data: FullTranslateBatchRequestData,
    sendResponse: (response: FullTranslateBatchResponseMessage) => void,
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        // Client-side quota pre-check (fast, non-blocking)
        const quotaManager = getQuotaManager()
        try {
            await quotaManager.checkFullTextTranslationQuota()
        } catch (quotaError) {
            logger.warn("Full-text translation quota exhausted (client cache)")
            const usage = await quotaManager.getFullTextTranslationQuotaUsage()
            sendResponse({
                success: false,
                error: quotaError instanceof Error ? quotaError.message : String(quotaError),
                errorType: "QuotaExceeded",
                quotaInfo: usage,
            })
            return
        }

        logger.debug(`Batch translation request: ${data.texts.length} segments`)
        const startTime = performance.now()

        const apiRequest: FullTextBatchApiRequest = {
            texts: data.texts,
            sourceLanguage: data.sourceLang,
            targetLanguage: data.targetLang,
        }

        const response = await post<FullTextBatchApiResponse, FullTextBatchApiRequest>(
            TRANSLATION_API_ENDPOINTS.TRANSLATE_FULL_TEXT_BATCH,
            apiRequest,
        )

        // Update local quota cache from server response
        if (response.quota) {
            await quotaManager.updateFullTextTranslationQuota(response.quota)
        }

        const elapsedMs = Math.round(performance.now() - startTime)
        logger.info(`[handleBatch] batch complete`, {
            total: data.texts.length,
            successCount: response.translations.length,
            elapsedMs,
        })

        sendResponse({
            success: true,
            translations: response.translations,
            quotaInfo: response.quota,
        })
    } catch (error) {
        // Handle server-side quota exceeded error (code 4001)
        if (error instanceof APIError && error.code === APIErrorCodes.QUOTA_EXCEEDED) {
            logger.warn("Full-text translation quota exceeded (server):", error.message)
            const quotaManager = getQuotaManager()
            // Mark quota as exhausted in local cache
            await quotaManager.updateFullTextTranslationQuota({ used: 0, limit: 0, remaining: 0 })
            const usage = await quotaManager.getFullTextTranslationQuotaUsage()
            sendResponse({
                success: false,
                error: error.message || "Daily free quota exceeded for full-text translation",
                errorType: "QuotaExceeded",
                quotaInfo: usage,
            })
            return
        }

        logger.error("Batch translation failed:", error)
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
