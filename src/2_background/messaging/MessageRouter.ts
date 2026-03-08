/**
 * Message Router
 *
 * Routes Chrome runtime messages to appropriate handlers
 */

import type { MessageType } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as FragmentTranslationRequestHandler from "../handlers/FragmentTranslationRequestHandler"
import { buildPopupBootstrapResponse } from "../handlers/PopupBootstrapHandler"
import * as SpeechSynthesisRequestHandler from "../handlers/SpeechSynthesisRequestHandler"
import * as TokenWarmUpHandler from "../handlers/TokenWarmUpHandler"
import * as TranslationRequestHandler from "../handlers/TranslationRequestHandler"

const logger = loggerModule.createLogger("MessageRouter")

/**
 * Setup message listener
 *
 * Registers the Chrome runtime message listener and routes messages
 * to appropriate handlers based on message type
 */
export function setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        logger.info("Message received in background:", message)

        // Route based on message type
        const messageType = message.type as MessageType

        switch (messageType) {
            case "TRANSLATE_REQUEST":
                TranslationRequestHandler.handleTranslationRequest(message, sendResponse)
                return true // Keep message channel open for async response

            case "FRAGMENT_TRANSLATE_REQUEST":
                FragmentTranslationRequestHandler.handleFragmentTranslationRequest(message, sendResponse)
                return true // Keep message channel open for async response

            case "SPEECH_SYNTHESIS_REQUEST":
                SpeechSynthesisRequestHandler.handleSpeechSynthesisRequest(message, sendResponse)
                return true // Keep message channel open for async response

            case "SPEECH_STOP_REQUEST":
                SpeechSynthesisRequestHandler.handleSpeechStopRequest(sendResponse)
                return true

            case "POPUP_BOOTSTRAP_REQUEST": {
                const response = buildPopupBootstrapResponse()
                sendResponse(response)
                return true
            }

            case "PAGE_ACTIVATED":
                TokenWarmUpHandler.handlePageActivated(sendResponse)
                return true

            default:
                logger.warn("Unknown message type:", messageType)
                sendResponse({ status: "ok" })
                return true
        }
    })

    logger.info("Message listener registered")
}
