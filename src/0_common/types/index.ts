/**
 * TypeScript Type Definitions
 *
 * Core types for the extension
 */

// Export QuotaExceededError
export { QuotaExceededError } from "./QuotaExceededError"

/**
 * Context information for translation
 */
export interface TranslationContextData {
    /** The selected word to translate */
    word: string
    /** The book name */
    bookName?: string
    /** Text before the word in the same sentence */
    leadingText: string
    /** Text after the word in the same sentence */
    trailingText: string
    /** Complete original sentence containing the word (leadingText + word + trailingText) */
    originalSentence?: string
    /** Previous sentences (1-2 sentences before) */
    previousSentences?: string[]
    /** Next sentences (1-2 sentences after) */
    nextSentences?: string[]
    /** Source language (optional, auto-detect if not provided) */
    sourceLanguage?: string
    /** Target language (default: 'zh') */
    targetLanguage?: string
    /** Use upgraded model when available (optional, used for refresh requests) */
    upgradeModel?: boolean
}

/**
 * Fragment translation context data
 */
export interface FragmentTranslationContextData {
    /** The text fragment to translate */
    fragment: string
    /** The book name */
    bookName?: string
    /** Text before the fragment in the same sentence (optional) */
    leadingText?: string
    /** Text after the fragment in the same sentence (optional) */
    trailingText?: string
    /** Previous sentences (1-2 sentences before) */
    previousSentences?: string[]
    /** Next sentences (1-2 sentences after) */
    nextSentences?: string[]
    /** Source language (optional, auto-detect if not provided) */
    sourceLanguage?: string
    /** Target language (default: 'zh') */
    targetLanguage?: string
    /** Use upgraded model when available (optional, used for refresh requests) */
    upgradeModel?: boolean
}

/**
 * Speech synthesis request data
 */
export interface SpeechSynthesisRequestData {
    /** The text to synthesize */
    text: string
    /** Language of the text (optional, auto-detect if not provided) */
    language?: string
}

/**
 * Message types for content-background communication
 */
export type MessageType = "TRANSLATE_REQUEST" | "FRAGMENT_TRANSLATE_REQUEST" | "SPEECH_SYNTHESIS_REQUEST" | "SPEECH_STOP_REQUEST" | "POPUP_BOOTSTRAP_REQUEST" | "PAGE_ACTIVATED"

/**
 * Page activated message (sent by content script on injection for token pre-warming)
 */
export interface PageActivatedMessage {
    type: "PAGE_ACTIVATED"
}

/**
 * Popup bootstrap request/response
 */
export interface PopupBootstrapRequestMessage {
    type: "POPUP_BOOTSTRAP_REQUEST"
}

export interface PopupBootstrapResponseMessage {
    type: "POPUP_BOOTSTRAP_RESPONSE"
    success: true
    data: {
        websiteUrl: string
        cloudVersion: string
        currentVersion: string
        needsUpdate: boolean
    }
}

/**
 * Translation request message
 */
export interface TranslateRequestMessage {
    type: "TRANSLATE_REQUEST"
    data: TranslationContextData
}

/**
 * Translation response message (success)
 */
export interface TranslateResponseSuccessMessage {
    type: "TRANSLATE_RESPONSE"
    success: true
    data: {
        wordTranslation: string
        sentenceTranslation?: string
        chineseDefinition?: string
        englishDefinition?: string
        targetDefinition?: string
        lemma?: string | null
        phonetic?: string
        lemmaPhonetic?: string
    }
}

/**
 * Translation response message (error)
 */
export interface TranslateResponseErrorMessage {
    type: "TRANSLATE_RESPONSE"
    success: false
    error: string
    /** Error type to distinguish TranslationError from generic errors and quota exceeded */
    errorType?: "TranslationError" | "QuotaExceeded" | "GenericError"
    /** Optional short error text for tooltip display */
    shortMessage?: string
}

/**
 * Translation response message (union type)
 */
export type TranslateResponseMessage = TranslateResponseSuccessMessage | TranslateResponseErrorMessage

/**
 * Fragment translation request message
 */
export interface FragmentTranslateRequestMessage {
    type: "FRAGMENT_TRANSLATE_REQUEST"
    data: FragmentTranslationContextData
}

/**
 * Fragment translation response message (success)
 */
export interface FragmentTranslateResponseSuccessMessage {
    type: "FRAGMENT_TRANSLATE_RESPONSE"
    success: true
    data: {
        translation: string
        sentenceTranslation?: string
    }
}

/**
 * Fragment translation response message (error)
 */
export interface FragmentTranslateResponseErrorMessage {
    type: "FRAGMENT_TRANSLATE_RESPONSE"
    success: false
    error: string
    /** Error type to distinguish TranslationError from generic errors and quota exceeded */
    errorType?: "TranslationError" | "QuotaExceeded" | "GenericError"
    /** Optional short error text for tooltip display */
    shortMessage?: string
}

/**
 * Fragment translation response message (union type)
 */
export type FragmentTranslateResponseMessage = FragmentTranslateResponseSuccessMessage | FragmentTranslateResponseErrorMessage

/**
 * Speech synthesis request message
 */
export interface SpeechSynthesisRequestMessage {
    type: "SPEECH_SYNTHESIS_REQUEST"
    data: SpeechSynthesisRequestData
}

/**
 * Speech stop request message
 */
export interface SpeechStopRequestMessage {
    type: "SPEECH_STOP_REQUEST"
}

/**
 * Speech synthesis response message (success)
 */
export interface SpeechSynthesisResponseSuccessMessage {
    type: "SPEECH_SYNTHESIS_RESPONSE"
    success: true
    data: {
        /** Audio data as a base64 string */
        audio?: string
    }
}

/**
 * Speech synthesis response message (error)
 */
export interface SpeechSynthesisResponseErrorMessage {
    type: "SPEECH_SYNTHESIS_RESPONSE"
    success: false
    error: string
    /** Error type to distinguish quota exceeded errors */
    errorType?: "QuotaExceeded" | "GenericError"
}

/**
 * Speech synthesis response message (union type)
 */
export type SpeechSynthesisResponseMessage = SpeechSynthesisResponseSuccessMessage | SpeechSynthesisResponseErrorMessage

/**
 * User settings for the extension
 */
export type TranslationFontSizePreset = "small" | "medium" | "large" | "extraLarge"

export type IconColor = "pink" | "blue" | "purple" | "green" | "orange" | "red" | "teal" | "indigo"

export type TriggerKey = "meta" | "option" | "alt" | "ctrl"

export type NetworkRegion = "auto" | "china" | "global"

/**
 * Translation provider type
 * - official: Official cloud API (default)
 * - customApi: User-provided LLM API
 * - mtranserver: Self-hosted MTranServer
 * - bingTranslate: Bing Translate API (free, no key required)
 */
export type TranslationProvider = "official" | "customApi" | "mtranserver" | "bingTranslate"

export interface CustomApiSettings {
    /** Custom API base URL */
    baseUrl: string
    /** Custom API key/token */
    apiKey: string
    /** Custom API model name */
    model: string
}

export interface MTranserverSettings {
    /** MTranserver URL */
    url: string
    /** MTranserver API key */
    key: string
    /** Whether to enable MTranserver */
    enabled: boolean
}

export interface BingTranslateSettings {
    /** Whether to enable Bing Translate */
    enabled: boolean
}

export interface UserSettings {
    /** Master switch to enable all translation features */
    enableTapWord: boolean
    /** Whether to show translation icon on text selection */
    showIcon: boolean
    /** Whether to translate single words on single-click */
    singleClickTranslate: boolean
    /** Whether to translate single words on double-click (Legacy, replaced by V2) */
    doubleClickTranslate: boolean
    /** Whether to translate single words on double-click (V2 default OFF) */
    doubleClickTranslateV2: boolean
    /** Whether to translate full sentences on Modifier+double-click */
    doubleClickSentenceTranslate: boolean
    /** Modifier key for sentence translation (meta, option, alt, ctrl) */
    doubleClickSentenceTriggerKey: TriggerKey
    /** Whether to automatically adjust original text line-height for better display */
    autoAdjustHeight: boolean
    /** Whether to restore original line-height when all translations in a block are removed */
    restoreLineHeightOnClear: boolean
    /** Whether to automatically play audio pronunciation for translated words */
    autoPlayAudio: boolean
    /** Target language for translation (zh, en, ja, ko, fr, es, ru) */
    targetLanguage: string
    /** Translation font size preset (small, medium, large, extraLarge) */
    translationFontSizePreset: TranslationFontSizePreset
    /**
     * Minimum font size for translation tooltip in pixels.
     * Derived from translationFontSizePreset for compatibility with legacy data.
     */
    translationFontSize: number
    /** Gap to keep between tooltip text and the next line (px) */
    tooltipNextLineGapPx: number
    /** Gap to keep between tooltip text and the next line (px) - V2 forced defaults */
    tooltipNextLineGapPxV2: number
    /** Vertical gap between selected text and tooltip (px, negative values pull tooltip upward/overlap) */
    tooltipVerticalOffsetPx: number
    /** Vertical gap between selected text and tooltip (px, negative values pull tooltip upward/overlap) - V2 forced defaults */
    tooltipVerticalOffsetPxV2: number
    /** Distance between the text baseline and the underline (px) */
    textUnderlineOffsetPx: number
    /** Distance between the text baseline and the underline (px) - V2 forced defaults */
    textUnderlineOffsetPxV2: number
    /** V3: distance between the original text and the tooltip underline (px) */
    tooltipUnderlineOffsetPxV3: number
    /** V3: distance between the tooltip underline and the translation text (px) */
    tooltipTextOffsetPxV3: number
    /** V3: extra blank space below the translation text (px) */
    tooltipBottomSpacingPxV3: number
    /** Color for single word translation underline (hex code) */
    wordUnderlineColor: string
    /** Color for single word translation underline (hex code) - V2 forced defaults */
    wordUnderlineColorV2: string
    /** Color for sentence translation underline (hex code) */
    sentenceUnderlineColor: string
    /** Icon background color */
    iconColor: IconColor
    /** Translation provider selection */
    translationProvider: TranslationProvider
    /** Custom API settings */
    customApi: CustomApiSettings
    /** MTranserver settings */
    mtranserver: MTranserverSettings
    /** Bing Translate settings */
    bingTranslate: BingTranslateSettings
    /** Whether to suppress translation when the detected source language matches the target language */
    suppressNativeLanguage: boolean
    /** Network region preference for API calls (auto, china, global) */
    networkRegion: NetworkRegion
}

/**
 * Default user settings
 * Note: targetLanguage default is 'en', but will be dynamically overridden
 * based on browser language for new users in storageManager.getUserSettings()
 */
export const DEFAULT_USER_SETTINGS: UserSettings = {
    enableTapWord: true,
    showIcon: true,
    singleClickTranslate: true,
    doubleClickTranslate: false,
    doubleClickTranslateV2: false,
    doubleClickSentenceTranslate: true,
    doubleClickSentenceTriggerKey: "alt",
    autoAdjustHeight: true,
    restoreLineHeightOnClear: false,
    autoPlayAudio: true,
    targetLanguage: "en",
    translationFontSizePreset: "medium",
    translationFontSize: 10,
    tooltipNextLineGapPx: 4,
    tooltipNextLineGapPxV2: 6,
    tooltipVerticalOffsetPx: 2,
    tooltipVerticalOffsetPxV2: 3,
    textUnderlineOffsetPx: 3,
    textUnderlineOffsetPxV2: 4,
    tooltipUnderlineOffsetPxV3: 1,
    tooltipTextOffsetPxV3: 1,
    tooltipBottomSpacingPxV3: 6,
    wordUnderlineColor: "#2A9D8F",
    wordUnderlineColorV2: "#1F7FDB",
    sentenceUnderlineColor: "#E9C46A",
    iconColor: "pink",
    translationProvider: "official",
    customApi: {
        baseUrl: "",
        apiKey: "",
        model: "",
    },
    mtranserver: {
        url: "http://127.0.0.1:8989",
        key: "",
        enabled: false,
    },
    bingTranslate: {
        enabled: true,
    },
    suppressNativeLanguage: false,
    networkRegion: "auto",
}

export const DEFAULT_SUPPRESS_NATIVE_LANGUAGE = DEFAULT_USER_SETTINGS.suppressNativeLanguage
