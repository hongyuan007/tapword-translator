/**
 * Application Constants
 */

export const APP_EDITION = import.meta.env.VITE_APP_EDITION || "official"
export const PRIVATE_CLOUD_ENABLED = import.meta.env.VITE_ENABLE_PRIVATE_CLOUD === "true"
export const ADVANCED_FEATURES_ENABLED = import.meta.env.VITE_ENABLE_ADVANCED_FEATURES !== "false"
export const AGENT_PANEL_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PANEL === "true"

export { ERROR_MESSAGES } from "./errorMessages"
export {
    DEFAULT_TRANSLATION_FONT_SIZE_PRESET,
    getFontSizePxFromPreset,
    resolveTranslationFontSize,
    TRANSLATION_FONT_SIZE_MAP,
} from "./translationFontSize"

export const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Extension UI ownership marker — used to exclude extension-injected DOM from full-text translation
 */
export const EXTENSION_OWNED_ATTRIBUTE = "data-tapword-ext"

/**
 * Visual styling constants
 */
export const UNDERLINE_OPACITY = 1

// Internal shift applied to the user-facing underline offset to derive the effective CSS offset
export const UNDERLINE_OFFSET_INTERNAL_SHIFT_PX = 2

/**
 * Upgrade model enabled flag
 * When true, all translation requests will use upgraded model by default
 * Configured via VITE_UPGRADE_MODEL environment variable
 */
export const UPGRADE_MODEL_ENABLED = import.meta.env.VITE_UPGRADE_MODEL === "true"
