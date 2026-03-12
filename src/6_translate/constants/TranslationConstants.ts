/**
 * Translation Module Constants
 */

/**
 * Translation API endpoints
 */
export const TRANSLATION_API_ENDPOINTS = {
    TRANSLATE: "/api/v1/translate",
    TRANSLATE_FRAGMENT: "/api/v1/translate/fragment",
    AUTO_CANDIDATES: "/api/v1/translate/auto-candidates",
} as const

/**
 * Global switch: use local LLM translation (8_generate) instead of cloud API
 * Will be wired to user settings in future
 */
export const USE_LOCAL_LLM_TRANSLATION = false

/**
 * Default local LLM configuration (placeholder; will be user-configurable)
 */
export const LOCAL_LLM_DEFAULT_CONFIG = {
    apiKey: "",
    baseUrl: "",
    model: "",
    temperature: 0.35,
    maxTokens: 1200,
    // Chrome MV3 service worker has no process.env; keep a static default timeout
    timeout: 10000,
}
