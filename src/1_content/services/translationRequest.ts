/**
 * Translation Request Handler
 *
 * Handles sending translation requests to background script and receiving responses
 */

import type {
    AutoCandidatesRequestData,
    AutoCandidatesRequestMessage,
    AutoCandidatesResponseMessage,
    FragmentTranslateRequestMessage,
    FragmentTranslateResponseMessage,
    FragmentTranslationContextData,
    TranslateRequestMessage,
    TranslateResponseMessage,
    TranslationContextData,
} from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("translationRequest")

/**
 * Request translation from background script
 *
 * @param context - Translation context data
 * @returns Promise resolving to translation result or error
 *
 * @example
 * ```typescript
 * const result = await requestTranslation({
 *     word: 'light',
 *     leadingText: 'The room was filled with natural ',
 *     trailingText: ' from the large windows.',
 *     previousSentences: ['He opened the curtains.'],
 *     nextSentences: ['It made the space feel warm.']
 * });
 *
 * if (result.success) {
 *     logger.info(result.data.wordTranslation);
 * } else {
 *     logger.error(result.error);
 * }
 * ```
 */
export async function requestTranslation(context: TranslationContextData): Promise<TranslateResponseMessage> {
    return sendMessageWithRetry<TranslateRequestMessage, TranslateResponseMessage>(
        {
            type: "TRANSLATE_REQUEST",
            data: context,
        },
        2,
        150
    )
}

/**
 * Request fragment translation from background script
 *
 * @param data - Fragment translation context data
 * @returns Promise resolving to fragment translation result or error
 *
 * @example
 * ```typescript
 * const result = await requestFragmentTranslation({
 *     fragment: 'of cryptocurrency exchange Gemini',
 *     leadingText: 'Additional donors include co-founders ',
 *     trailingText: ', Tyler and Cameron Winklevoss.',
 *     sourceLanguage: 'en',
 *     targetLanguage: 'zh'
 * });
 *
 * if (result.success) {
 *     logger.info(result.data.translation);
 * } else {
 *     logger.error(result.error);
 * }
 * ```
 */
export async function requestFragmentTranslation(data: FragmentTranslationContextData): Promise<FragmentTranslateResponseMessage> {
    return sendMessageWithRetry<FragmentTranslateRequestMessage, FragmentTranslateResponseMessage>(
        {
            type: "FRAGMENT_TRANSLATE_REQUEST",
            data,
        },
        2,
        150
    )
}

/**
 * Request auto-translation candidates from background script
 *
 * @param data - Auto-candidates request data
 * @returns Promise resolving to auto-candidates result or error
 */
export async function requestAutoCandidates(data: AutoCandidatesRequestData): Promise<AutoCandidatesResponseMessage> {
    return sendMessageWithRetry<AutoCandidatesRequestMessage, AutoCandidatesResponseMessage>(
        {
            type: "AUTO_CANDIDATES_REQUEST",
            data,
        },
        2,
        150
    )
}

// ============================================================================
// Internal Helper: sendMessageWithRetry
// ============================================================================

function sendMessageWithRetry<TMessage extends { type: string }, TResponse>(message: TMessage, retries: number, delayMs: number): Promise<TResponse> {
    return new Promise((resolve, reject) => {
        const attemptStartTs = Date.now()
        let attempt = 0

        const send = () => {
            attempt++
            logger.info("[RETRY_DEBUG] Sending message attempt", attempt, message)
            chrome.runtime.sendMessage(message, (response: TResponse) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message
                    logger.error("[RETRY_DEBUG] Chrome runtime error on attempt", attempt, errMsg)
                    // Specific race condition: background not ready yet
                    if (attempt <= retries && errMsg && errMsg.includes("Receiving end does not exist")) {
                        logger.warn("[RETRY_DEBUG] Background likely not initialized. Scheduling retry in", `${delayMs}ms`)
                        setTimeout(send, delayMs)
                        return
                    }
                    reject(new Error(errMsg))
                    return
                }

                if (!response) {
                    logger.error("[RETRY_DEBUG] Empty response on attempt", attempt)
                    if (attempt <= retries) {
                        logger.warn("[RETRY_DEBUG] Retrying empty response in", `${delayMs}ms`)
                        setTimeout(send, delayMs)
                        return
                    }
                    reject(new Error("No response from background script"))
                    return
                }

                const duration = Date.now() - attemptStartTs
                logger.info("[RETRY_DEBUG] Message successful on attempt", attempt, "duration(ms)=", duration)
                resolve(response)
            })
        }

        send()
    })
}
