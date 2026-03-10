import type { SpeechSynthesisRequestMessage, SpeechSynthesisResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { getQuotaManager } from "@/5_backend"
import * as speechModule from "@/7_speech"
import * as offscreenManager from "../services/OffscreenManager"
import * as errorHandler from "./BackgroundErrorHandler"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("SpeechSynthesisRequestHandler")

/**
 * Handle speech synthesis request from content script
 *
 * @param message - Speech synthesis request message
 * @param sendResponse - Response callback function
 */
export async function handleSpeechSynthesisRequest(
    message: SpeechSynthesisRequestMessage,
    sendResponse: (response: SpeechSynthesisResponseMessage) => void
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const { text, language } = message.data

        logger.info("Synthesizing speech for text:", text)

        // Check quota before speech synthesis
        const quotaManager = getQuotaManager()
        await quotaManager.checkSpeechQuota()

        // Call speech synthesis service
        const result = await speechModule.synthesizeSpeech({
            text,
            language,
        })

        logger.info("Speech synthesis result received, cacheHit:", result.cacheHit)

        // Only increment quota counter if NOT from cache
        if (!result.cacheHit) {
            await quotaManager.incrementSpeechCount()
            logger.info("Speech quota incremented (cache miss)")
        } else {
            logger.info("Speech quota not incremented (cache hit)")
        }

        // Play audio in offscreen document
        // We intentionally await this to ensure playback starts and to catch immediate errors
        // (like offscreen document creation failure), at the cost of some added latency.
        await offscreenManager.playAudio(result.audio)

        // Send success response (audio data not needed in content script anymore)
        sendResponse({
            type: "SPEECH_SYNTHESIS_RESPONSE",
            success: true,
            data: {},
        })
    } catch (error) {
        logger.error("Speech synthesis error:", error)
        errorHandler.handleSpeechSynthesisRequestError(error, sendResponse)
    }
}

/**
 * Handle speech stop request from content script
 *
 * @param sendResponse - Response callback function
 */
export async function handleSpeechStopRequest(sendResponse: (response: { success: boolean }) => void): Promise<void> {
    try {
        await offscreenManager.stopAudio()
        sendResponse({ success: true })
    } catch (error) {
        logger.warn("Error stopping speech:", error)
        sendResponse({ success: false })
    }
}
