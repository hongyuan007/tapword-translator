/**
 * Centralized Target Language Registry
 *
 * Single source of truth for supported translation target languages.
 * Used by storageManager (auto-detect), popup/options HTML (select options),
 * and any code that validates or enumerates target languages.
 */

export interface TargetLanguageOption {
    code: string       // API value: "zh", "zh-tw", "en", etc.
    display: string    // UI label: "中文（简体）", "中文（繁體）"
}

export const TARGET_LANGUAGES: TargetLanguageOption[] = [
    { code: "en",  display: "English" },
    { code: "zh",  display: "中文（简体）" },
    { code: "zh-tw", display: "中文（繁體）" },
    { code: "es",  display: "Español" },
    { code: "ja",  display: "日本語" },
    { code: "fr",  display: "Français" },
    { code: "de",  display: "Deutsch" },
    { code: "ko",  display: "한국어" },
    { code: "ru",  display: "Русский" },
]

export const TARGET_LANGUAGE_CODES = TARGET_LANGUAGES.map(l => l.code)
