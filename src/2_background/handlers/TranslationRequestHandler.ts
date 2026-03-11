/**
 * Translation Request Handler
 *
 * Handles translation requests from content scripts
 */

import type { TranslateRequestMessage, TranslateResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { getQuotaManager } from "@/5_backend"
import * as translateModule from "@/6_translate"
import * as errorHandler from "./BackgroundErrorHandler"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("TranslationRequestHandler")

/**
 * Handle translation request from content script
 *
 * @param message - Translation request message
 * @param sendResponse - Response callback function
 */
export async function handleTranslationRequest(
    message: TranslateRequestMessage,
    sendResponse: (response: TranslateResponseMessage) => void
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const { word, leadingText, trailingText, previousSentences, nextSentences, sourceLanguage, targetLanguage, upgradeModel, bookName } =
            message.data

        logger.info("Translating word:", word, "with context")

        // Check quota before translation
        const quotaManager = getQuotaManager()
        await quotaManager.checkTranslationQuota()

        // Call translation service
        const result = await translateModule.translateWord({
            word,
            leadingText,
            trailingText,
            sourceLanguage,
            targetLanguage,
            upgradeModel,
            contextInfo: {
                previousSentences,
                nextSentences,
                bookName,
            },
        })

        logger.info("Translation result:", result)

        // Increment quota counter after successful translation
        await quotaManager.incrementTranslationCount()

        // Send success response
        sendResponse({
            type: "TRANSLATE_RESPONSE",
            success: true,
            data: {
                wordTranslation: result.wordTranslation,
                sentenceTranslation: result.sentenceTranslation,
                chineseDefinition: result.chineseDefinition,
                englishDefinition: result.englishDefinition,
                targetDefinition: result.targetDefinition,
                lemma: result.lemma,
                phonetic: result.phonetic,
                lemmaPhonetic: result.lemmaPhonetic,
            },
        })
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error("Translation error:", errorMessage, errorStack)
        errorHandler.handleTranslationRequestError(error, sendResponse)
    }
}
