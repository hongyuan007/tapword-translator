/**
 * Full-Page Batch Translation Request Handler
 *
 * Handles batch translation requests from content script.
 * Uses the dedicated full-text-batch endpoint for LLM-level batching.
 */

import type { FullTranslateBatchRequestData, FullTranslateBatchResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { post } from "@/5_backend"
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

        const elapsedMs = Math.round(performance.now() - startTime)
        logger.info(`[handleBatch] batch complete`, {
            total: data.texts.length,
            successCount: response.translations.length,
            elapsedMs,
        })

        sendResponse({
            success: true,
            translations: response.translations,
        })
    } catch (error) {
        logger.error("Batch translation failed:", error)
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
