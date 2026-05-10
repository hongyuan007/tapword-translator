/**
 * Full-Page Batch Translation Request Handler
 *
 * Routes full-page translation requests to the appropriate provider:
 * - official: Cloud API with quota management
 * - customApi: Local LLM (OpenAI-compatible)
 * - mtranserver: Self-hosted MTranServer (parallel MT)
 * - bingTranslate: Bing Translate (parallel MT)
 */

import type { FullTranslateBatchRequestData, FullTranslateBatchResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import { CUSTOM_API_FIXED_PARAMS } from "@/0_common/constants/customApi"
import { APIError, APIErrorCodes, post } from "@/5_backend"
import { getQuotaManager } from "@/5_backend/services/QuotaManager"
import { TRANSLATION_API_ENDPOINTS } from "@/6_translate/constants/TranslationConstants"
import type { FullTextBatchApiRequest, FullTextBatchApiResponse } from "@/6_translate/types/TranslationApiTypes"
import * as mtranServerServiceModule from "@/6_translate/services/MTranServerService"
import * as bingTranslateServiceModule from "@/6_translate/services/BingTranslateService"
import type { MTranserverSettings, BingTranslateSettings, CustomApiSettings } from "@/0_common/types"
import * as generateModule from "@/8_generate"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("FullTranslateBatchHandler")

// ─── Provider implementations ────────────────────────────────────────────────

async function translateWithOfficialApi(data: FullTranslateBatchRequestData): Promise<FullTranslateBatchResponseMessage> {
    const quotaManager = getQuotaManager()

    // Client-side pre-check to avoid unnecessary network round-trips
    try {
        await quotaManager.checkFullTextTranslationQuota()
    } catch (quotaError) {
        logger.warn("Full-text translation quota exhausted (client cache)")
        const usage = await quotaManager.getFullTextTranslationQuotaUsage()
        return {
            success: false,
            error: quotaError instanceof Error ? quotaError.message : String(quotaError),
            errorType: "QuotaExceeded",
            quotaInfo: usage,
        }
    }

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

    if (response.quota) {
        await quotaManager.updateFullTextTranslationQuota(response.quota)
    }

    const elapsedMs = Math.round(performance.now() - startTime)
    logger.info("Official API batch complete", { total: data.texts.length, elapsedMs })

    return { success: true, translations: response.translations, quotaInfo: response.quota }
}

async function translateWithCustomApi(
    data: FullTranslateBatchRequestData,
    customApi: CustomApiSettings,
): Promise<FullTranslateBatchResponseMessage> {
    const apiKey = customApi.apiKey.trim()
    const baseUrl = customApi.baseUrl.trim()
    const model = customApi.model.trim()

    if (!apiKey || !baseUrl || !model) {
        return { success: false, error: "Custom API configuration is incomplete (missing apiKey, baseUrl, or model)" }
    }

    const llmConfig: generateModule.LLMConfig = {
        apiKey,
        baseUrl,
        model,
        temperature: CUSTOM_API_FIXED_PARAMS.temperature,
        maxTokens: generateModule.MAX_TOKENS_FULL_TEXT_BATCH,
        timeout: CUSTOM_API_FIXED_PARAMS.timeout,
    }

    const translations = await generateModule.generateFullTextBatch(data.texts, data.sourceLang, data.targetLang, llmConfig)
    logger.info("CustomApi batch complete", { total: data.texts.length })
    return { success: true, translations }
}

async function translateWithMTranServerProvider(
    data: FullTranslateBatchRequestData,
    settings: MTranserverSettings,
): Promise<FullTranslateBatchResponseMessage> {
    logger.debug("MTranServer batch translation", { segments: data.texts.length })
    const translations = await Promise.all(
        data.texts.map((text) => mtranServerServiceModule.translateWithMTranServer(text, data.targetLang, settings)),
    )
    return { success: true, translations }
}

async function translateWithBingTranslateProvider(
    data: FullTranslateBatchRequestData,
    settings: BingTranslateSettings,
): Promise<FullTranslateBatchResponseMessage> {
    logger.debug("BingTranslate batch translation", { segments: data.texts.length })
    const translations = await Promise.all(
        data.texts.map((text) => bingTranslateServiceModule.translateWithBingTranslate(text, data.targetLang, settings)),
    )
    return { success: true, translations }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handle batch translation request from content script.
 * Routes to the appropriate provider based on user settings.
 */
export async function handleFullTranslateBatchRequest(
    data: FullTranslateBatchRequestData,
    sendResponse: (response: FullTranslateBatchResponseMessage) => void,
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const settings = await storageManagerModule.getUserSettings()
        const provider = settings.translationProvider

        logger.debug("Full-text batch request", { provider, segments: data.texts.length })

        let result: FullTranslateBatchResponseMessage
        switch (provider) {
            case "customApi":
                result = await translateWithCustomApi(data, settings.customApi)
                break
            case "mtranserver":
                result = await translateWithMTranServerProvider(data, settings.mtranserver)
                break
            case "bingTranslate":
                result = await translateWithBingTranslateProvider(data, settings.bingTranslate)
                break
            default:
                // "official" — cloud API with quota management
                result = await translateWithOfficialApi(data)
        }

        sendResponse(result)
    } catch (error) {
        // Server-side quota exceeded (code 4001) — update local cache
        if (error instanceof APIError && error.code === APIErrorCodes.QUOTA_EXCEEDED) {
            logger.warn("Full-text translation quota exceeded (server):", error.message)
            const quotaManager = getQuotaManager()
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
