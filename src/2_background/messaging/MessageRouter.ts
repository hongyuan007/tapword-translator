/**
 * Message Router
 *
 * Routes Chrome runtime messages to appropriate handlers
 */

import type { MessageType } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as AutoCandidatesRequestHandler from "../handlers/AutoCandidatesRequestHandler"
import * as FragmentTranslationRequestHandler from "../handlers/FragmentTranslationRequestHandler"
import * as FullTranslateBatchHandler from "../handlers/FullTranslateBatchHandler"
import { buildPopupBootstrapResponse } from "../handlers/PopupBootstrapHandler"
import * as QuotaUsageHandler from "../handlers/QuotaUsageHandler"
import * as SpeechSynthesisRequestHandler from "../handlers/SpeechSynthesisRequestHandler"
import * as TokenWarmUpHandler from "../handlers/TokenWarmUpHandler"
import * as TranslationRequestHandler from "../handlers/TranslationRequestHandler"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("MessageRouter")

/** Tracks whether the sidepanel is open per window (windowId → isOpen) */
const sidepanelOpenState = new Map<number, boolean>()

/**
 * Setup message listener
 *
 * Registers the Chrome runtime message listener and routes messages
 * to appropriate handlers based on message type
 */
export function setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
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
                void serviceInitializer.ensureCriticalServicesReady()
                    .then(() => {
                        const response = buildPopupBootstrapResponse()
                        sendResponse(response)
                    })
                    .catch((error) => {
                        logger.error("Failed to build popup bootstrap response:", error)
                        sendResponse(buildPopupBootstrapResponse())
                    })
                return true
            }

            case "PAGE_ACTIVATED":
                TokenWarmUpHandler.handlePageActivated(sendResponse)
                return true

            case "AUTO_CANDIDATES_REQUEST":
                AutoCandidatesRequestHandler.handleAutoCandidatesRequest(message, sendResponse)
                return true

            case "FULL_TRANSLATE_BATCH_REQUEST":
                FullTranslateBatchHandler.handleFullTranslateBatchRequest(message.data, sendResponse)
                return true

            case "QUOTA_USAGE_REQUEST":
                QuotaUsageHandler.handleQuotaUsageRequest(sendResponse)
                return true

            case "FULL_TRANSLATE_TOGGLE": {
                // Forward to the active tab's content script
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.id) {
                        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                            if (chrome.runtime.lastError) {
                                logger.warn("No content script on this page:", chrome.runtime.lastError.message)
                                sendResponse({ success: false, isRunning: false, error: "No content script available on this page" })
                            } else {
                                sendResponse(response ?? {
                                    success: false,
                                    isRunning: false,
                                    error: "No response from content script",
                                })
                            }
                        })
                    } else {
                        sendResponse({ success: false, isRunning: false, error: "No active tab found" })
                    }
                })
                return true
            }

            case "FULL_TRANSLATE_STATUS_REQUEST": {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.id) {
                        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                            if (chrome.runtime.lastError) {
                                logger.warn("Unable to query full-translate status:", chrome.runtime.lastError.message)
                                sendResponse({ success: false, isRunning: false, error: "No content script available on this page" })
                            } else {
                                sendResponse(response ?? {
                                    success: false,
                                    isRunning: false,
                                    error: "No response from content script",
                                })
                            }
                        })
                    } else {
                        sendResponse({ success: false, isRunning: false, error: "No active tab found" })
                    }
                })
                return true
            }

            case "GET_PAGE_CONTENT": {
                try {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]?.id) {
                            // Target main frame only (frameId: 0) to avoid iframe content
                            chrome.tabs.sendMessage(tabs[0].id, message, { frameId: 0 }, (response) => {
                                if (chrome.runtime.lastError) {
                                    logger.warn("Failed to get page content:", chrome.runtime.lastError.message)
                                    sendResponse({ success: false, error: "No content script available on this page" })
                                } else {
                                    sendResponse(response ?? { success: false, error: "No response from content script" })
                                }
                            })
                        } else {
                            sendResponse({ success: false, error: "No active tab found" })
                        }
                    })
                } catch (error) {
                    logger.error("Failed to get page content:", error)
                    sendResponse({ success: false, error: String(error) })
                }
                return true
            }

            case "OPEN_SIDE_PANEL": {
                const windowId = sender.tab?.windowId
                if (windowId === undefined) {
                    sendResponse({ success: false, error: 'No window context' })
                    return true
                }
                chrome.sidePanel.open({ windowId })
                    .then(() => {
                        sidepanelOpenState.set(windowId, true)
                        sendResponse({ success: true })
                    })
                    .catch((error) => {
                        logger.warn('Failed to open side panel:', error)
                        sendResponse({ success: false, error: String(error) })
                    })
                return true
            }

            case "TOGGLE_SIDE_PANEL": {
                const windowId = sender.tab?.windowId
                if (windowId === undefined) {
                    sendResponse({ success: false, error: 'No window context' })
                    return true
                }
                const isCurrentlyOpen = sidepanelOpenState.get(windowId) ?? false
                if (isCurrentlyOpen) {
                    // Close: disable then re-enable to force sidepanel closed
                    chrome.sidePanel.setOptions({ enabled: false })
                        .then(() => chrome.sidePanel.setOptions({ enabled: true }))
                        .then(() => {
                            sidepanelOpenState.set(windowId, false)
                            sendResponse({ success: true, isOpen: false })
                        })
                        .catch((error) => {
                            logger.warn('Failed to close side panel:', error)
                            sendResponse({ success: false, error: String(error) })
                        })
                } else {
                    // Open
                    chrome.sidePanel.open({ windowId })
                        .then(() => {
                            sidepanelOpenState.set(windowId, true)
                            sendResponse({ success: true, isOpen: true })
                        })
                        .catch((error) => {
                            logger.warn('Failed to open side panel:', error)
                            sendResponse({ success: false, error: String(error) })
                        })
                }
                return true
            }

            case "SIDE_PANEL_OPENED": {
                const windowId = sender.tab?.windowId
                if (windowId !== undefined) {
                    sidepanelOpenState.set(windowId, true)
                }
                sendResponse({ success: true })
                return true
            }

            case "SIDE_PANEL_CLOSED": {
                const windowId = sender.tab?.windowId
                if (windowId !== undefined) {
                    sidepanelOpenState.set(windowId, false)
                }
                sendResponse({ success: true })
                return true
            }

            case "GET_SELECTED_TEXT": {
                try {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]?.id) {
                            // Target main frame only (frameId: 0) to avoid iframe content
                            chrome.tabs.sendMessage(tabs[0].id, message, { frameId: 0 }, (response) => {
                                if (chrome.runtime.lastError) {
                                    logger.warn("Failed to get selected text:", chrome.runtime.lastError.message)
                                    sendResponse({ success: false, error: "No content script available on this page" })
                                } else {
                                    sendResponse(response ?? { success: false, error: "No response from content script" })
                                }
                            })
                        } else {
                            sendResponse({ success: false, error: "No active tab found" })
                        }
                    })
                } catch (error) {
                    logger.error("Failed to get selected text:", error)
                    sendResponse({ success: false, error: String(error) })
                }
                return true
            }

            case "FETCH_URL": {
                const url = message.url as string
                if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                    sendResponse({ success: false, error: "Invalid URL: must start with http:// or https://" })
                    return true
                }
                const FETCH_TIMEOUT_MS = 30_000
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
                fetch(url, { signal: controller.signal })
                    .then((response) => {
                        clearTimeout(timeoutId)
                        return response.text().then((text) => ({
                            success: true as const,
                            content: text,
                            contentType: response.headers.get("content-type") ?? "",
                            statusCode: response.status,
                        }))
                    })
                    .then((result) => sendResponse(result))
                    .catch((err) => {
                        clearTimeout(timeoutId)
                        const errorMessage = err instanceof Error && err.name === "AbortError"
                            ? "Request timed out after 30 seconds."
                            : err instanceof Error ? err.message : String(err)
                        logger.warn(`FETCH_URL failed for ${url}:`, errorMessage)
                        sendResponse({ success: false, error: errorMessage })
                    })
                return true
            }

            default:
                logger.warn("Unknown message type:", messageType)
                sendResponse({ status: "ok" })
                return true
        }
        } catch (error) {
            logger.error("[MessageRouter] Top-level error in onMessage listener:", error)
            try {
                sendResponse({ success: false, error: `Internal error: ${String(error)}` })
            } catch {
                // sendResponse may already have been called
            }
            return true
        }
    })

    logger.info("Message listener registered")
}
