/**
 * Language Tag Utilities
 *
 * Shared functions for BCP 47 language tag normalization and comparison.
 * Used by languageValidator.ts (selection-based suppression) and
 * pageLanguageChecker.ts (page-level floating button suppression).
 */

/** Normalize a language tag: lowercase, replace underscores with hyphens, preserve full BCP 47 tag. */
export function normalizeLanguageTagFull(tag: string | null | undefined): string {
    if (!tag) return ""
    return tag.trim().toLowerCase().replace(/_/g, "-")
}

/** Normalize locale metadata from og:locale or content-language: first token, hyphens. */
export function normalizeLocaleMeta(content: string | null | undefined): string {
    if (!content) return ""
    const firstToken = content.split(",")[0]?.trim().toLowerCase() ?? ""
    if (!firstToken) return ""
    return firstToken.replace(/_/g, "-")
}

/** Check if a language tag represents Traditional Chinese. */
export function isTraditionalChinese(lang: string): boolean {
    const lower = lang.toLowerCase()
    return lower.includes("hant") || lower.includes("tw") || lower.includes("hk") || lower.includes("mo")
}

/** Extract the primary language subtag (before the first hyphen). */
export function getMainSubtag(lang: string): string {
    return lang.split("-")[0]?.trim().toLowerCase() ?? ""
}

/**
 * Compare two language tags to decide if they represent the same language.
 * For zh-* languages, differentiate between Simplified and Traditional.
 * For other languages, only compare the primary subtag.
 */
export function isSameLanguage(pageLang: string, targetLang: string): boolean {
    const normalizedPage = normalizeLanguageTagFull(pageLang)
    const normalizedTarget = normalizeLanguageTagFull(targetLang)
    if (normalizedPage === normalizedTarget) return true

    const pageMain = getMainSubtag(normalizedPage)
    const targetMain = getMainSubtag(normalizedTarget)

    if (pageMain === "zh" && targetMain === "zh") {
        return isTraditionalChinese(normalizedPage) === isTraditionalChinese(normalizedTarget)
    }
    return pageMain === targetMain
}
