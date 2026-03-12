/**
 * Auto-Candidates Service
 *
 * Calls the cloud API endpoint for auto-translation candidates.
 * Follows the same pattern as TranslationService.ts.
 */

import { createLogger } from "@/0_common/utils/logger"
import * as i18nModule from "@/0_common/utils/i18n"
import { post, APIError } from "@/5_backend"
import { TRANSLATION_API_ENDPOINTS } from "../constants/TranslationConstants"
import type { AutoCandidatesApiRequest, AutoCandidatesApiResponse } from "../types/AutoCandidatesTypes"
import type { AutoCandidatesRequestData } from "@/0_common/types"
import { TranslationError } from "../types/TranslationError"

const logger = createLogger("AutoCandidatesService")

/**
 * Request auto-translation candidates from the cloud API
 *
 * @param params - Auto-candidates request data
 * @returns Promise with auto-candidates API response
 * @throws TranslationError for API or unexpected errors
 */
export async function requestAutoTranslateCandidates(params: AutoCandidatesRequestData): Promise<AutoCandidatesApiResponse> {
    try {
        const request: AutoCandidatesApiRequest = {
            sourceLang: params.sourceLang,
            targetLang: params.targetLang,
            blockText: params.blockText,
            manualTrigger: params.manualTrigger,
            userLevel: params.userLevel,
            excludedTexts: params.excludedTexts,
        }

        logger.info("Sending auto-candidates request:", { sourceLang: request.sourceLang, targetLang: request.targetLang })

        const data = await post<AutoCandidatesApiResponse, AutoCandidatesApiRequest>(
            TRANSLATION_API_ENDPOINTS.AUTO_CANDIDATES,
            request
        )

        logger.info("Auto-candidates response:", { traceId: data.traceId, candidateCount: data.candidates.length })

        return data
    } catch (error: unknown) {
        // Re-throw TranslationError as-is
        if (error instanceof TranslationError) {
            throw error
        }

        // Convert APIError to TranslationError
        if (error instanceof APIError) {
            handleAPIError(error)
        }

        // Handle unexpected errors
        logger.error("Unexpected auto-candidates error:", error)
        throw new TranslationError(
            i18nModule.translate("error.serverBusy"),
            i18nModule.translate("error.short.serverBusy")
        )
    }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert APIError to TranslationError with user-friendly i18n messages
 */
function handleAPIError(error: APIError): never {
    switch (error.type) {
        case "rateLimited":
            throw new TranslationError(
                i18nModule.translate("error.rateLimited"),
                i18nModule.translate("error.short.rateLimited")
            )

        case "businessError":
            switch (error.code) {
                case 20001:
                    throw new TranslationError(
                        i18nModule.translate("error.contentBlocked"),
                        i18nModule.translate("error.short.contentBlocked")
                    )
                case 20429:
                case 20504:
                    throw new TranslationError(
                        i18nModule.translate("error.serverBusy"),
                        i18nModule.translate("error.short.serverBusy")
                    )
                case 20500:
                    throw new TranslationError(
                        i18nModule.translate("error.serviceUnavailable"),
                        i18nModule.translate("error.short.serviceUnavailable")
                    )
                default:
                    throw new TranslationError(
                        i18nModule.translate("error.serverBusy"),
                        i18nModule.translate("error.short.serverBusy")
                    )
            }

        case "serverAlert":
            throw new TranslationError(
                error.message || i18nModule.translate("error.serverBusy"),
                i18nModule.translate("error.short.serverBusy")
            )

        default:
            throw new TranslationError(
                i18nModule.translate("error.serverBusy"),
                i18nModule.translate("error.short.serverBusy")
            )
    }
}
