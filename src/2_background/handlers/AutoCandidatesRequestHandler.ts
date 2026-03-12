/**
 * Auto-Candidates Request Handler
 *
 * Handles auto-candidates requests from content scripts.
 * Routes to the appropriate provider based on user settings.
 */

import type { AutoCandidatesRequestMessage, AutoCandidatesResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import { CUSTOM_API_FIXED_PARAMS } from "@/0_common/constants/customApi"
import * as translateModule from "@/6_translate"
import * as generateModule from "@/8_generate"
import * as serviceInitializer from "../services/ServiceInitializer"

const logger = loggerModule.createLogger("AutoCandidatesRequestHandler")

/**
 * Handle auto-candidates request from content script
 *
 * @param message - Auto-candidates request message
 * @param sendResponse - Response callback function
 */
export async function handleAutoCandidatesRequest(
    message: AutoCandidatesRequestMessage,
    sendResponse: (response: AutoCandidatesResponseMessage) => void
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        const settings = await storageManagerModule.getUserSettings()
        const provider = settings.translationProvider

        logger.info("Auto-candidates request, provider:", provider, "sourceLang:", message.data.sourceLang)

        if (provider === "mtranserver" || provider === "bingTranslate") {
            sendResponse({
                type: "AUTO_CANDIDATES_RESPONSE",
                success: false,
                error: `Auto-candidates not supported for provider: ${provider}`,
            })
            return
        }

        if (provider === "customApi") {
            const customApi = settings.customApi
            const apiKey = customApi.apiKey.trim()
            const baseUrl = customApi.baseUrl.trim()
            const model = customApi.model.trim()

            if (!apiKey || !baseUrl || !model) {
                sendResponse({
                    type: "AUTO_CANDIDATES_RESPONSE",
                    success: false,
                    error: "Custom API configuration is incomplete (missing apiKey, baseUrl, or model)",
                })
                return
            }

            const llmConfig: generateModule.LLMConfig = {
                apiKey,
                baseUrl,
                model,
                temperature: CUSTOM_API_FIXED_PARAMS.temperature,
                maxTokens: CUSTOM_API_FIXED_PARAMS.maxTokens,
                timeout: CUSTOM_API_FIXED_PARAMS.timeout,
            }

            const result = await generateModule.generateAutoCandidates(message.data, llmConfig)

            logger.info("Local auto-candidates result: traceId=", result.traceId, "candidates=", result.candidates.length)

            sendResponse({
                type: "AUTO_CANDIDATES_RESPONSE",
                success: true,
                data: result,
            })
            return
        }

        // Official cloud API (default)
        const result = await translateModule.requestAutoTranslateCandidates(message.data)

        logger.info("Auto-candidates result: traceId=", result.traceId, "candidates=", result.candidates.length)

        sendResponse({
            type: "AUTO_CANDIDATES_RESPONSE",
            success: true,
            data: result,
        })
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error("Auto-candidates error:", errorMessage)

        sendResponse({
            type: "AUTO_CANDIDATES_RESPONSE",
            success: false,
            error: errorMessage,
        })
    }
}
