/**
 * Translation Service
 *
 * Provides translation functionality using the centralized Translation API v1
 */

import { createLogger } from "@/0_common/utils/logger"
import * as i18nModule from "@/0_common/utils/i18n"
import { post, APIError } from "@/5_backend"
import { TRANSLATION_API_ENDPOINTS } from "../constants/TranslationConstants"
import {
    FragmentTranslationApiRequest,
    FragmentTranslationApiResponse,
    TranslationApiRequest,
    TranslationApiResponse,
} from "../types/TranslationApiTypes"
import { FragmentTranslationResult, TranslateFragmentParams, TranslateParams, TranslationResult } from "../types/TranslationModels"
import { TranslationError } from "../types/TranslationError"
import { createWordTranslationService, WordTranslationService } from "@/8_generate/services/WordTranslationService"
import { createFragmentTranslationService, FragmentTranslationService } from "@/8_generate/services/FragmentTranslationService"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import type { UserSettings } from "@/0_common/types"
import type { LLMConfig } from "@/8_generate/types/GenerateTypes"
import { CUSTOM_API_FIXED_PARAMS } from "@/0_common/constants/customApi"
import { translateWithMTranServer, MTranServerError } from "./MTranServerService"
import { translateWithBingTranslate, BingTranslateError } from "./BingTranslateService"

const logger = createLogger("TranslationService")

const TRANSLATION_REQUEST_TIMEOUT_MS = 15000

let localWordServicePromise: Promise<WordTranslationService> | null = null
let localFragmentServicePromise: Promise<FragmentTranslationService> | null = null
let cachedLocalConfigSignature: string | null = null
let cachedUserSettings: UserSettings | null = null

function computeConfigSignature(config: LLMConfig): string {
    return [config.baseUrl, config.model, config.apiKey, config.temperature ?? "", config.maxTokens ?? "", config.timeout ?? ""].join("|")
}

function resetLocalServiceCache(): void {
    localWordServicePromise = null
    localFragmentServicePromise = null
    cachedLocalConfigSignature = null
}

async function getCachedUserSettings(): Promise<UserSettings> {
    if (cachedUserSettings) {
        return cachedUserSettings
    }

    cachedUserSettings = await storageManagerModule.getUserSettings()
    return cachedUserSettings
}

function buildLocalLlmConfig(settings: UserSettings): LLMConfig | null {
    // Only build LLM config when customApi provider is selected
    if (settings.translationProvider !== "customApi") {
        return null
    }

    const customApi = settings.customApi
    const apiKey = customApi.apiKey.trim()
    const baseUrl = customApi.baseUrl.trim()
    const model = customApi.model.trim()

    if (!apiKey || !baseUrl || !model) {
        throw new TranslationError(i18nModule.translate("error.customApiConfigMissing"), i18nModule.translate("error.short.customApiConfigMissing"))
    }

    return {
        apiKey,
        baseUrl,
        model,
        temperature: CUSTOM_API_FIXED_PARAMS.temperature,
        maxTokens: CUSTOM_API_FIXED_PARAMS.maxTokens,
        timeout: CUSTOM_API_FIXED_PARAMS.timeout,
    }
}

async function getLocalWordService(config: LLMConfig): Promise<WordTranslationService> {
    const signature = computeConfigSignature(config)
    if (!localWordServicePromise || signature !== cachedLocalConfigSignature) {
        localWordServicePromise = createWordTranslationService(config)
        cachedLocalConfigSignature = signature
    }
    return localWordServicePromise
}

async function getLocalFragmentService(config: LLMConfig): Promise<FragmentTranslationService> {
    const signature = computeConfigSignature(config)
    if (!localFragmentServicePromise || signature !== cachedLocalConfigSignature) {
        localFragmentServicePromise = createFragmentTranslationService(config)
        cachedLocalConfigSignature = signature
    }
    return localFragmentServicePromise
}

async function translateWordWithLocal(params: TranslateParams, config: LLMConfig): Promise<TranslationResult> {
    const { word, leadingText, trailingText, sourceLanguage, targetLanguage = "zh", contextInfo } = params

    logger.info("Using local LLM translation (8_generate)")

    const service = await getLocalWordService(config)
    const localResult = await service.translateWord({
        word,
        leadingText,
        trailingText,
        sourceLanguage,
        targetLanguage,
        contextInfo: {
            previousSentences: contextInfo?.previousSentences,
            nextSentences: contextInfo?.nextSentences,
            sourceTitle: contextInfo?.bookName,
            sourceAuthor: contextInfo?.bookAuthor,
        },
    })

    return {
        wordTranslation: localResult.wordTranslation,
        sentenceTranslation: localResult.fragmentTranslation,
        chineseDefinition: undefined,
        englishDefinition: undefined,
        targetDefinition: undefined,
        lemma: undefined,
        phonetic: undefined,
        lemmaPhonetic: undefined,
    }
}

async function translateFragmentWithLocal(params: TranslateFragmentParams, config: LLMConfig): Promise<FragmentTranslationResult> {
    const { fragment, leadingText, trailingText, sourceLanguage, targetLanguage = "zh", contextInfo } = params

    logger.info("Using local LLM fragment translation (8_generate)")

    const service = await getLocalFragmentService(config)
    const localResult = await service.translateFragment({
        fragment,
        leadingText,
        trailingText,
        sourceLanguage,
        targetLanguage,
        contextInfo: {
            previousSentences: contextInfo?.previousSentences,
            nextSentences: contextInfo?.nextSentences,
            sourceTitle: contextInfo?.bookName,
            sourceAuthor: contextInfo?.bookAuthor,
        },
    })

    return {
        translation: localResult.translation,
        sentenceTranslation: localResult.sentenceTranslation,
    }
}

/**
 * Convert APIError to TranslationError with user-friendly i18n messages
 */
function handleAPIError(error: APIError): never {
    switch (error.type) {
        case "rateLimited":
            throw new TranslationError(i18nModule.translate("error.rateLimited"), i18nModule.translate("error.short.rateLimited"))

        case "businessError":
            switch (error.code) {
                case 20001:
                    throw new TranslationError(i18nModule.translate("error.contentBlocked"), i18nModule.translate("error.short.contentBlocked"))
                case 20429:
                case 20504:
                    throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
                case 20500:
                    throw new TranslationError(
                        i18nModule.translate("error.serviceUnavailable"),
                        i18nModule.translate("error.short.serviceUnavailable")
                    )
                default:
                    throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
            }

        case "serverAlert":
            throw new TranslationError(error.message || i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))

        // Network-level errors: user's network is blocking or unreachable
        case "timeout":
            throw new TranslationError(i18nModule.translate("error.networkTimeout"), i18nModule.translate("error.short.networkTimeout"))

        case "requestError":
            if (error.code && error.code >= 500) {
                // 5xx = server-side issue
                throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
            }
            // 4xx or no code = likely network/proxy issue
            throw new TranslationError(i18nModule.translate("error.networkError"), i18nModule.translate("error.short.networkError"))

        case "unexpectedError":
            // "Failed to fetch" = network blocked/unreachable
            throw new TranslationError(i18nModule.translate("error.networkError"), i18nModule.translate("error.short.networkError"))

        default:
            throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
    }
}

async function translateWordWithCloud(params: TranslateParams): Promise<TranslationResult> {
    const { word, leadingText, trailingText, sourceLanguage, targetLanguage = "zh", upgradeModel, contextInfo } = params

    const request: TranslationApiRequest = {
        text: word,
        sourceLanguage,
        targetLanguage,
        ...(upgradeModel && { upgradeModel: true }),
        context: {
            leadingText,
            trailingText,
            previousSentences: contextInfo?.previousSentences,
            nextSentences: contextInfo?.nextSentences,
            bookName: contextInfo?.bookName,
            bookAuthor: contextInfo?.bookAuthor,
        },
    }

    logger.info("Sending translation request:", request)

    const data = await post<TranslationApiResponse, TranslationApiRequest>(TRANSLATION_API_ENDPOINTS.TRANSLATE, request, { timeout: TRANSLATION_REQUEST_TIMEOUT_MS })

    logger.info("Translation response data:", data)

    return {
        wordTranslation: data.wordTranslation,
        sentenceTranslation: data.sentenceTranslation,
        chineseDefinition: data.chineseDefinition,
        englishDefinition: data.englishDefinition,
        targetDefinition: data.targetDefinition,
        lemma: data.lemma,
        phonetic: data.phonetic,
        lemmaPhonetic: data.lemmaPhonetic,
    }
}

/**
 * Translate a word with context
 *
 * @param params - Translation parameters
 * @returns Promise with translation result
 * @throws APIError subclasses for different error scenarios
 *
 * @example
 * ```typescript
 * const result = await translateWord({
 *     word: 'light',
 *     leadingText: 'The room was filled with natural ',
 *     trailingText: ' from the large windows.',
 *     sourceLanguage: 'en',
 *     targetLanguage: 'zh',
 *     contextInfo: {
 *         previousSentences: ['He opened the curtains.'],
 *         nextSentences: ['It made the space feel warm and inviting.'],
 *         bookName: 'Harry Potter',
 *         bookAuthor: 'J.K. Rowling'
 *     }
 * });
 * ```
 */
export async function translateWord(params: TranslateParams): Promise<TranslationResult> {
    try {
        const userSettings = await getCachedUserSettings()

        // Check translation provider selection
        const provider = userSettings.translationProvider

        // MTranServer
        if (provider === "mtranserver") {
            const mtranserverSettings = userSettings.mtranserver
            if (!mtranserverSettings.url || !mtranserverSettings.url.trim()) {
                throw new TranslationError(
                    i18nModule.translate("error.mtranserverConfigMissing"),
                    i18nModule.translate("error.short.mtranserverConfigMissing")
                )
            }

            logger.info("Translating word using MTranServer")
            const { word, leadingText, trailingText, targetLanguage = "zh" } = params

            const fullSentence = `${leadingText || ""}${word}${trailingText || ""}`
            const hasContext = Boolean(leadingText || trailingText)

            const [wordTranslation, sentenceTranslation] = await Promise.all([
                translateWithMTranServer(word, targetLanguage, mtranserverSettings),
                hasContext
                    ? translateWithMTranServer(fullSentence, targetLanguage, mtranserverSettings)
                    : Promise.resolve(undefined),
            ])

            return {
                wordTranslation: wordTranslation,
                sentenceTranslation: sentenceTranslation,
                chineseDefinition: undefined,
                englishDefinition: undefined,
                targetDefinition: undefined,
                lemma: undefined,
                phonetic: undefined,
                lemmaPhonetic: undefined,
            }
        }

        // Custom API
        if (provider === "customApi") {
            const localConfig = buildLocalLlmConfig(userSettings)
            if (!localConfig) {
                throw new TranslationError(
                    i18nModule.translate("error.customApiConfigMissing"),
                    i18nModule.translate("error.short.customApiConfigMissing")
                )
            }

            logger.info("Translating word using custom LLM API")
            return await translateWordWithLocal(params, localConfig)
        }

        // Bing Translate
        if (provider === "bingTranslate") {
            logger.info("Translating word using Bing Translate")
            const { word, leadingText, trailingText, targetLanguage = "zh" } = params

            const fullSentence = `${leadingText || ""}${word}${trailingText || ""}`
            const hasContext = Boolean(leadingText || trailingText)

            const [wordTranslation, sentenceTranslation] = await Promise.all([
                translateWithBingTranslate(word, targetLanguage, userSettings.bingTranslate),
                hasContext
                    ? translateWithBingTranslate(fullSentence, targetLanguage, userSettings.bingTranslate)
                    : Promise.resolve(undefined),
            ])

            return {
                wordTranslation: wordTranslation,
                sentenceTranslation: sentenceTranslation,
                chineseDefinition: undefined,
                englishDefinition: undefined,
                targetDefinition: undefined,
                lemma: undefined,
                phonetic: undefined,
                lemmaPhonetic: undefined,
            }
        }

        // Official Cloud API (default)
        logger.info("Translating word using cloud API translation")
        return await translateWordWithCloud(params)
    } catch (error: unknown) {
        // Re-throw TranslationError as-is
        if (error instanceof TranslationError) {
            throw error
        }

        // Handle MTranServerError
        if (error instanceof MTranServerError) {
            logger.error("MTranServer translation error:", error.message)
            throw new TranslationError(
                error.message,
                i18nModule.translate("error.short.mtranserverError")
            )
        }

        // Handle BingTranslateError
        if (error instanceof BingTranslateError) {
            logger.error("Bing Translate translation error:", error.message)
            throw new TranslationError(
                error.message,
                i18nModule.translate("error.short.bingTranslateError")
            )
        }

        // Convert APIError to TranslationError
        if (error instanceof APIError) {
            handleAPIError(error)
        }

        // Handle unexpected errors
        logger.error("Unexpected translation error:", error)
        throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
    }
}

/**
 * Translate a text fragment with context
 *
 * @param params - Fragment translation parameters
 * @returns Promise with fragment translation result
 * @throws APIError subclasses for different error scenarios
 *
 * @example
 * ```typescript
 * const result = await translateFragment({
 *     fragment: 'of cryptocurrency exchange Gemini',
 *     leadingText: 'Additional donors include co-founders ',
 *     trailingText: ', Tyler and Cameron Winklevoss.',
 *     sourceLanguage: 'en',
 *     targetLanguage: 'zh',
 *     contextInfo: {
 *         previousSentences: ['The funding round was successful.'],
 *         nextSentences: ['They contributed significantly to the project.'],
 *         bookName: 'Tech News',
 *         bookAuthor: 'John Doe'
 *     }
 * });
 * ```
 */
export async function translateFragment(params: TranslateFragmentParams): Promise<FragmentTranslationResult> {
    try {
        const userSettings = await getCachedUserSettings()

        // Check translation provider selection
        const provider = userSettings.translationProvider

        // MTranServer
        if (provider === "mtranserver") {
            const mtranserverSettings = userSettings.mtranserver
            if (!mtranserverSettings.url || !mtranserverSettings.url.trim()) {
                throw new TranslationError(
                    i18nModule.translate("error.mtranserverConfigMissing"),
                    i18nModule.translate("error.short.mtranserverConfigMissing")
                )
            }

            logger.info("Translating fragment using MTranServer")
            const { fragment, leadingText, trailingText, targetLanguage = "zh" } = params

            const fullSentence = `${leadingText || ""}${fragment}${trailingText || ""}`
            const hasContext = Boolean(leadingText || trailingText)

            const [translation, sentenceTranslation] = await Promise.all([
                translateWithMTranServer(fragment, targetLanguage, mtranserverSettings),
                hasContext
                    ? translateWithMTranServer(fullSentence, targetLanguage, mtranserverSettings)
                    : Promise.resolve(undefined),
            ])

            return {
                translation: translation,
                sentenceTranslation: sentenceTranslation,
            }
        }

        // Custom API
        if (provider === "customApi") {
            const localConfig = buildLocalLlmConfig(userSettings)
            if (!localConfig) {
                throw new TranslationError(
                    i18nModule.translate("error.customApiConfigMissing"),
                    i18nModule.translate("error.short.customApiConfigMissing")
                )
            }

            logger.info("Translating fragment using custom LLM API")
            return await translateFragmentWithLocal(params, localConfig)
        }

        // Bing Translate
        if (provider === "bingTranslate") {
            logger.info("Translating fragment using Bing Translate")
            const { fragment, leadingText, trailingText, targetLanguage = "zh" } = params

            const fullSentence = `${leadingText || ""}${fragment}${trailingText || ""}`
            const hasContext = Boolean(leadingText || trailingText)

            const [translation, sentenceTranslation] = await Promise.all([
                translateWithBingTranslate(fragment, targetLanguage, userSettings.bingTranslate),
                hasContext
                    ? translateWithBingTranslate(fullSentence, targetLanguage, userSettings.bingTranslate)
                    : Promise.resolve(undefined),
            ])

            return {
                translation: translation,
                sentenceTranslation: sentenceTranslation,
            }
        }

        // Official Cloud API (default)
        const { fragment, leadingText, trailingText, sourceLanguage, targetLanguage = "zh", upgradeModel, contextInfo } = params

        // Build API request
        const request: FragmentTranslationApiRequest = {
            text: fragment,
            leadingText,
            trailingText,
            sourceLanguage,
            targetLanguage,
            ...(upgradeModel && { upgradeModel: true }),
            context: contextInfo
                ? {
                      previousSentences: contextInfo.previousSentences,
                      nextSentences: contextInfo.nextSentences,
                      bookName: contextInfo.bookName,
                      bookAuthor: contextInfo.bookAuthor,
                  }
                : undefined,
        }

        logger.info("Sending fragment translation request:", request)

        // Make API request - post() now returns data directly and handles errors
        const data = await post<FragmentTranslationApiResponse, FragmentTranslationApiRequest>(TRANSLATION_API_ENDPOINTS.TRANSLATE_FRAGMENT, request, { timeout: TRANSLATION_REQUEST_TIMEOUT_MS })

        logger.info("Fragment translation response data:", data)

        // Return fragment translation result
        return {
            translation: data.translation,
            sentenceTranslation: data.sentenceTranslation,
        }
    } catch (error: unknown) {
        // Re-throw TranslationError as-is
        if (error instanceof TranslationError) {
            throw error
        }

        // Handle MTranServerError
        if (error instanceof MTranServerError) {
            logger.error("MTranServer fragment translation error:", error.message)
            throw new TranslationError(
                error.message,
                i18nModule.translate("error.short.mtranserverError")
            )
        }

        // Handle BingTranslateError
        if (error instanceof BingTranslateError) {
            logger.error("Bing Translate fragment translation error:", error.message)
            throw new TranslationError(
                error.message,
                i18nModule.translate("error.short.bingTranslateError")
            )
        }

        // Convert APIError to TranslationError
        if (error instanceof APIError) {
            handleAPIError(error)
        }

        // Handle unexpected errors
        logger.error("Unexpected fragment translation error:", error)
        throw new TranslationError(i18nModule.translate("error.serverBusy"), i18nModule.translate("error.short.serverBusy"))
    }
}

try {
    chrome.storage?.onChanged.addListener((changes, areaName) => {
        if (areaName !== "sync") {
            return
        }

        if (changes.userSettings) {
            cachedUserSettings = null
            resetLocalServiceCache()
        }
    })
} catch (error) {
    logger.warn("Failed to register storage change listener for local LLM cache reset", error)
}
