/**
 * Language Display Utilities
 *
 * Provides human-readable language names with Intl.DisplayNames fallback.
 */

const DEFAULT_FALLBACK_LOCALE = "en"

const LANGUAGE_NAME_MAP: Record<string, string> = {
    en: "English",
    zh: "中文",
    "zh-tw": "繁體中文",
    es: "Español",
    ja: "日本語",
    fr: "Français",
    de: "Deutsch",
    ko: "한국어",
    ru: "Русский",
}

function resolveLocale(locale?: string): string {
    if (locale && locale.trim().length > 0) {
        return locale
    }
    if (typeof navigator !== "undefined" && navigator.language) {
        return navigator.language
    }
    return DEFAULT_FALLBACK_LOCALE
}

export function getLanguageDisplayName(languageCode: string, locale?: string): string {
    const normalizedCode = languageCode.toLowerCase()
    try {
        if (typeof Intl !== "undefined" && typeof (Intl as any).DisplayNames === "function") {
            const displayNames = new (Intl as any).DisplayNames([resolveLocale(locale)], { type: "language" })
            const name = displayNames.of(normalizedCode)
            if (name) {
                return name
            }
        }
    } catch {
        // Fallback below if Intl.DisplayNames is not available or fails
    }

    return LANGUAGE_NAME_MAP[normalizedCode] || languageCode
}
