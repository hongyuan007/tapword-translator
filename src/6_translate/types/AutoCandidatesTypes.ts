/**
 * Auto-Candidates API Types
 *
 * Request/response types for the auto-candidates translation API endpoint.
 * Core message types (AutoCandidatesRequestData, AutoCandidate, etc.) are
 * defined in @/0_common/types for cross-module access.
 */

import type { AutoCandidatesRequestData, AutoCandidatesResponseData } from "@/0_common/types"

/**
 * Auto-candidates API request payload
 */
export interface AutoCandidatesApiRequest {
    sourceLang: AutoCandidatesRequestData["sourceLang"]
    targetLang: AutoCandidatesRequestData["targetLang"]
    blockText: AutoCandidatesRequestData["blockText"]
    manualTrigger: AutoCandidatesRequestData["manualTrigger"]
    userLevel: AutoCandidatesRequestData["userLevel"]
    excludedTexts: AutoCandidatesRequestData["excludedTexts"]
}

/**
 * Auto-candidates API response data
 */
export interface AutoCandidatesApiResponse {
    traceId: AutoCandidatesResponseData["traceId"]
    candidates: AutoCandidatesResponseData["candidates"]
    meta: AutoCandidatesResponseData["meta"]
    warnings?: AutoCandidatesResponseData["warnings"]
}
