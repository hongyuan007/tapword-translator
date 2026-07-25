/**
 * Type definitions for 8_generate module
 */

/**
 * LLM chat message role
 */
export type ChatRole = "system" | "user" | "assistant"

/**
 * LLM chat message
 */
export interface ChatMessage {
    role: ChatRole
    content: string
}

/**
 * LLM provider configuration
 */
export interface LLMConfig {
    /** API key for authentication */
    apiKey: string
    /** Base URL for API endpoint */
    baseUrl: string
    /** Model name/identifier */
    model: string
    /** Temperature for generation (0-2, default: 0.35) */
    temperature?: number
    /** Maximum tokens to generate (default: 1200) */
    maxTokens?: number
    /** Use max_completion_tokens instead of max_tokens. Required for OpenAI gpt-5 and o-series models. Default: false */
    useMaxCompletionTokens?: boolean
    /** Request timeout in milliseconds (default: 10000) */
    timeout?: number
}

/**
 * Word translation request parameters
 */
export interface WordTranslationRequest {
    /** Word to translate */
    word: string
    /** Text before the word in the sentence */
    leadingText?: string
    /** Text after the word in the sentence */
    trailingText?: string
    /** Source language code (e.g., 'en', 'zh') */
    sourceLanguage?: string
    /** Target language code (e.g., 'zh', 'en', default: 'zh') */
    targetLanguage?: string
    /** Optional context information */
    contextInfo?: {
        /** Sentences before the current sentence */
        previousSentences?: string[]
        /** Sentences after the current sentence */
        nextSentences?: string[]
        /** Source title (e.g., book name, article title) */
        sourceTitle?: string
        /** Source author */
        sourceAuthor?: string
        /** Source type (e.g., 'book', 'article', 'webpage') */
        sourceType?: string
        /** Dictionary definition for reference */
        dictionaryDefinition?: string
    }
}

/**
 * Word translation result
 */
export interface WordTranslationResult {
    /** Translation of the target word */
    wordTranslation: string
    /** Translation of the text fragment/sentence containing the word */
    fragmentTranslation?: string
}

/**
 * Fragment translation request parameters
 */
export interface FragmentTranslationRequest {
    /** Text fragment to translate */
    fragment: string
    /** Text before the fragment inside the sentence */
    leadingText?: string
    /** Text after the fragment inside the sentence */
    trailingText?: string
    /** Source language code (e.g., 'en', 'zh') */
    sourceLanguage?: string
    /** Target language code (e.g., 'zh', 'en', default: 'zh') */
    targetLanguage?: string
    /** Optional context information */
    contextInfo?: {
        /** Sentences before the current sentence */
        previousSentences?: string[]
        /** Sentences after the current sentence */
        nextSentences?: string[]
        /** Source title (e.g., book name, article title) */
        sourceTitle?: string
        /** Source author */
        sourceAuthor?: string
        /** Source type (e.g., 'book', 'article', 'webpage') */
        sourceType?: string
    }
}

/**
 * Fragment translation result
 */
export interface FragmentTranslationResult {
    /** Translation of the target fragment */
    translation: string
    /** Translation of the complete sentence containing the fragment */
    sentenceTranslation?: string
}

/**
 * Raw fragment LLM response format (JSON structure)
 */
export interface LLMFragmentTranslationResponse {
    /** Translation of the target fragment */
    translation: string
    /** Translation of the complete sentence containing the fragment */
    sentence_translation?: string
}

/**
 * Raw LLM response format (JSON structure)
 */
export interface LLMTranslationResponse {
    /** Translation of the target word */
    word_translation: string
    /** Translation of the text fragment */
    fragment_translation: string
}
