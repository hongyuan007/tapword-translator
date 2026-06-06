/**
 * 8_generate Module Entry Point
 *
 * Exports public API for local LLM-based translation generation
 */

// Services
export { WordTranslationService, createWordTranslationService, translateWord } from "./services/WordTranslationService"
export { FragmentTranslationService, createFragmentTranslationService, translateFragment } from "./services/FragmentTranslationService"
export { AutoCandidatesGenerationService, generateAutoCandidates } from "./services/AutoCandidatesGenerationService"
export { FullTextBatchGenerationService, generateFullTextBatch } from "./services/FullTextBatchGenerationService"
export { OpenAICompatibleClient, createOpenAICompatibleClient } from "./services/llm/OpenAICompatibleClient"

// Types
export type {
    LLMConfig,
    WordTranslationRequest,
    WordTranslationResult,
    FragmentTranslationRequest,
    FragmentTranslationResult,
    ChatMessage,
    ChatRole,
} from "./types/GenerateTypes"

// Constants
export { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT, MAX_TOKENS_FULL_TEXT_BATCH } from "./constants/GenerateConstants"
