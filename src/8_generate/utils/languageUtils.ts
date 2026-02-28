/**
 * Language utilities for 8_generate module
 */

/**
 * Language name mapping
 */
const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    zh: "Chinese",
    auto: "Auto-Detect",
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    ru: "Russian",
    it: "Italian",
    pt: "Portuguese",
    ar: "Arabic",
    hi: "Hindi",
    th: "Thai",
    vi: "Vietnamese",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
}

/**
 * Get human-readable language name from language code
 * @param languageCode Language code (e.g., 'en', 'zh', 'zh-CN')
 * @returns Human-readable language name (e.g., 'English', 'Chinese')
 */
export function getLanguageName(languageCode: string): string {
    const normalized = languageCode.toLowerCase()
    return LANGUAGE_NAMES[normalized] || languageCode
}

/**
 * Get language names for source and target languages
 * @param sourceLanguage Source language code
 * @param targetLanguage Target language code
 * @returns Object with sourceName and targetName
 */
export function getLanguageNames(sourceLanguage?: string, targetLanguage?: string): { sourceName: string; targetName: string } {
    return {
        sourceName: getLanguageName(sourceLanguage || "en"),
        targetName: getLanguageName(targetLanguage || "zh"),
    }
}
