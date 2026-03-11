/**
 * Fragment Translation Request Handler
 *
 * Handles fragment translation requests from content scripts
 */

import type { FragmentTranslateRequestMessage, FragmentTranslateResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { getQuotaManager } from "@/5_backend"
import * as translateModule from "@/6_translate"
import * as errorHandler from "./BackgroundErrorHandler"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("FragmentTranslationRequestHandler")

/**
 * Handle fragment translation request from content script
 *
 * @param message - Fragment translation request message
 * @param sendResponse - Response callback function
 */
export async function handleFragmentTranslationRequest(
    message: FragmentTranslateRequestMessage,
    sendResponse: (response: FragmentTranslateResponseMessage) => void
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const { fragment, leadingText, trailingText, previousSentences, nextSentences, sourceLanguage, targetLanguage, upgradeModel, bookName } =
            message.data

        logger.info("Translating fragment:", fragment)

        // Check quota before translation
        const quotaManager = getQuotaManager()
        await quotaManager.checkTranslationQuota()

        // Call fragment translation service
        const result = await translateModule.translateFragment({
            fragment,
            leadingText,
            trailingText,
            sourceLanguage,
            targetLanguage,
            upgradeModel,
            contextInfo:
                previousSentences || nextSentences || bookName
                    ? {
                          previousSentences,
                          nextSentences,
                          bookName,
                      }
                    : undefined,
        })

        logger.info("Fragment translation result:", result)

        // Increment quota counter after successful translation
        await quotaManager.incrementTranslationCount()

        // Send success response
        sendResponse({
            type: "FRAGMENT_TRANSLATE_RESPONSE",
            success: true,
            data: {
                translation: result.translation,
                sentenceTranslation: result.sentenceTranslation,
            },
        })
    } catch (error: unknown) {
        logger.error("Fragment translation error:", error)
        errorHandler.handleFragmentTranslationRequestError(error, sendResponse)
    }
}
