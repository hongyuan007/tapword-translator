/**
 * Translation Module
 *
 * Main entry point for translation functionality
 *
 * This module handles all translation-related business logic,
 * including word translation, context-aware translation, and result formatting.
 */

// Export types
export type { FragmentTranslationResult, TranslateFragmentParams, TranslateParams, TranslationResult } from "./types/TranslationModels"
export type { AutoCandidatesApiRequest, AutoCandidatesApiResponse } from "./types/AutoCandidatesTypes"
export { TranslationError } from "./types/TranslationError"

// Export constants
export { TRANSLATION_API_ENDPOINTS } from "./constants/TranslationConstants"

// Export services
export { translateFragment, translateWord } from "./services/TranslationService"
export { requestAutoTranslateCandidates } from "./services/AutoCandidatesService"
