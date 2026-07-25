/**
 * Full-Page Batch Translation Request Handler
 *
 * Routes full-page translation requests to the appropriate provider:
 * - official: Cloud API with quota management
 * - microsoftFree: Microsoft free translation
 * - googleFree: Google free translation
 * - custom ID: User-defined OpenAI-compatible provider
 */

import type {
    CustomAiProvider,
    FullTextTranslationQuotaInfo,
    FullTranslateBatchRequestData,
    FullTranslateBatchResponseMessage,
    FullTranslateFallbackInfo,
} from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import { CUSTOM_API_FIXED_PARAMS } from "@/0_common/constants/customApi"
import { APIError, APIErrorCodes, post } from "@/5_backend"
import { getQuotaManager } from "@/5_backend/services/QuotaManager"
import { TRANSLATION_API_ENDPOINTS } from "@/6_translate/constants/TranslationConstants"
import type { FullTextBatchApiRequest, FullTextBatchApiResponse } from "@/6_translate/types/TranslationApiTypes"
import * as microsoftFreeServiceModule from "@/6_translate/services/MicrosoftFreeService"
import * as googleFreeServiceModule from "@/6_translate/services/GoogleFreeService"
import * as bingTranslateServiceModule from "@/6_translate/services/BingTranslateService"
import * as generateModule from "@/8_generate"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("FullTranslateBatchHandler")
const FIXED_PROVIDERS = ["official", "microsoftFree", "bingTranslate", "googleFree"]
const OFFICIAL_QUOTA_FALLBACK_INFO: FullTranslateFallbackInfo = {
    sourceProvider: "official",
    actualProvider: "microsoftFree",
    reason: "quotaExceeded",
}

async function markOfficialQuotaExhausted(): Promise<FullTextTranslationQuotaInfo> {
    const quotaManager = getQuotaManager()
    await quotaManager.updateFullTextTranslationQuota({ used: 0, limit: 0, remaining: 0 })
    return await quotaManager.getFullTextTranslationQuotaUsage()
}

function withOfficialQuotaFallback(
    result: FullTranslateBatchResponseMessage,
    quotaInfo?: FullTextTranslationQuotaInfo,
): FullTranslateBatchResponseMessage {
    return {
        ...result,
        quotaInfo: result.quotaInfo ?? quotaInfo,
        fallbackInfo: OFFICIAL_QUOTA_FALLBACK_INFO,
    }
}

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
    customProvider: CustomAiProvider,
): Promise<FullTranslateBatchResponseMessage> {
    const apiKey = customProvider.apiKey.trim()
    const baseUrl = customProvider.endpoint.trim()
    const model = customProvider.model.trim()

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
        useMaxCompletionTokens: customProvider.useMaxCompletionTokens ?? false,
    }

    const translations = await generateModule.generateFullTextBatch(data.texts, data.sourceLang, data.targetLang, llmConfig)
    logger.info("CustomApi batch complete", { total: data.texts.length })
    return { success: true, translations }
}

async function translateWithMicrosoftFreeProvider(
    data: FullTranslateBatchRequestData,
): Promise<FullTranslateBatchResponseMessage> {
    logger.debug("MicrosoftFree batch translation", { segments: data.texts.length })
    const translations = await Promise.all(
        data.texts.map((text) => microsoftFreeServiceModule.translateWithMicrosoftFree(text, data.targetLang)),
    )
    return { success: true, translations }
}

async function translateWithGoogleFreeProvider(
    data: FullTranslateBatchRequestData,
): Promise<FullTranslateBatchResponseMessage> {
    logger.debug("GoogleFree batch translation", { segments: data.texts.length })
    const translations = await Promise.all(
        data.texts.map((text) => googleFreeServiceModule.translateWithGoogleFree(text, data.targetLang)),
    )
    return { success: true, translations }
}

async function translateWithBingTranslateProvider(
    data: FullTranslateBatchRequestData,
    networkRegion: string,
): Promise<FullTranslateBatchResponseMessage> {
    logger.debug("BingTranslate batch translation", { segments: data.texts.length, networkRegion })
    const translations = await Promise.all(
        data.texts.map((text) => bingTranslateServiceModule.translateWithBingTranslate(text, data.targetLang, networkRegion)),
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
        const provider = settings.fullPageTranslationProvider
        const networkRegion = settings.networkRegion ?? "auto"

        logger.debug("Full-text batch request", { provider, segments: data.texts.length })

        let result: FullTranslateBatchResponseMessage
        switch (provider) {
            case "microsoftFree":
                result = await translateWithMicrosoftFreeProvider(data)
                break
            case "bingTranslate":
                result = await translateWithBingTranslateProvider(data, networkRegion)
                break
            case "googleFree":
                result = await translateWithGoogleFreeProvider(data)
                break
            case "official":
                // cloud API with quota management, with fallback to microsoftFree on quota exceeded
                try {
                    const officialResult = await translateWithOfficialApi(data)
                    if (!officialResult.success && officialResult.errorType === "QuotaExceeded") {
                        logger.warn("Official API quota exceeded, falling back to microsoftFree")
                        const fallbackResult = await translateWithMicrosoftFreeProvider(data)
                        result = withOfficialQuotaFallback(fallbackResult, officialResult.quotaInfo)
                    } else {
                        result = officialResult
                    }
                } catch (officialError) {
                    if (officialError instanceof APIError && officialError.code === APIErrorCodes.QUOTA_EXCEEDED) {
                        logger.warn("Official API quota exceeded (exception), falling back to microsoftFree")
                        const quotaInfo = await markOfficialQuotaExhausted()
                        const fallbackResult = await translateWithMicrosoftFreeProvider(data)
                        result = withOfficialQuotaFallback(fallbackResult, quotaInfo)
                    } else {
                        throw officialError
                    }
                }
                break
            default:
                // Custom provider — resolve by ID
                if (!FIXED_PROVIDERS.includes(provider)) {
                    const customProvider = settings.customProviders.find(p => p.id === provider)
                    if (!customProvider) {
                        result = { success: false, error: `Custom provider not found: ${provider}` }
                    } else {
                        result = await translateWithCustomApi(data, customProvider)
                    }
                } else {
                    // Unrecognised fixed name — fall back to official
                    result = await translateWithOfficialApi(data)
                }
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
