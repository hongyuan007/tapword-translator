/**
 * Language Validator Utility
 *
 * Validates text content against target language settings to determine if translation is necessary.
 * Handles "Native Speaker Suppression" logic.
 */
import * as loggerModule from "@/0_common/utils/logger"
import { detectSourceLanguageAsync } from "@/1_content/utils/languageDetector"

const logger = loggerModule.createLogger("languageValidator")

const CHINESE_RATIO_THRESHOLD = 0.05
const CONTEXT_CHINESE_RATIO_THRESHOLD = 0.10

function getPageDeclaredLanguage(): string {
    if (typeof document === "undefined") return ""

    const htmlLang = normalizeLanguageTag(document.documentElement.lang)
    if (htmlLang) {
        return htmlLang
    }

    const xmlLang = normalizeLanguageTag(document.documentElement.getAttribute("xml:lang"))
    if (xmlLang) {
        return xmlLang
    }

    const ogLocale = normalizeLocaleMeta(document.querySelector('meta[property="og:locale"]')?.getAttribute("content"))
    const contentLanguage = normalizeLocaleMeta(document.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content"))

    if (ogLocale && contentLanguage && ogLocale === contentLanguage) {
        return ogLocale
    }

    return ogLocale || contentLanguage || ""
}

// Script Regexes
const REGEX_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const REGEX_HANGUL = /\p{Script=Hangul}/u
const REGEX_CYRILLIC = /\p{Script=Cyrillic}/u
const REGEX_HAN = /\p{Script=Han}/gu
const REGEX_LATIN = /\p{Script=Latin}/gu

/**
 * Determines whether to trigger translation (show icon or immediate translate) based on text content and target language.
 *
 * Logic:
 * - If text matches the target language's native script, we assume the user is a native speaker reading their own language
 *   and does not need translation.
 * - For Chinese ('zh'), we use a ratio check because Han characters are shared with Japanese.
 * - For Japanese ('ja'), we check for Kana (Hiragana/Katakana) which are unique to Japanese.
 * - For Korean ('ko') and Russian ('ru'), we check for their specific scripts.
 * - For all languages, we also check the page's `<html lang="...">` metadata as a fast, reliable signal.
 * - For Chinese and other languages (e.g., 'es', 'fr'), we use async language detection on the context text
 *   as a further fallback. If the detected language matches the target, we suppress translation.
 *
 * @param text - The selected text
 * @param targetLanguage - The user's target language setting
 * @param contextText - Surrounding text context for more accurate language detection (optional but recommended for non-script-based languages)
 * @returns true if translation should be triggered, false if it should be suppressed
 */
export async function shouldTriggerTranslationAsync(text: string, targetLanguage: string, contextText?: string): Promise<boolean> {
    const tgtLang = (targetLanguage || "").toLowerCase().split("-")[0] // Normalize 'zh-CN' -> 'zh'
    const pageDeclaredLanguage = getPageDeclaredLanguage()

    switch (tgtLang) {
        case "zh": {
            // 1. Check if the selection ITSELF is Chinese
            // Check for Han characters ratio, but allow if Japanese Kana is present
            if (REGEX_KANA.test(text)) {
                return true // It's likely Japanese, so show translation for Chinese user
            }
            // Count Han characters
            const chineseMatches = text.match(REGEX_HAN)
            const chineseCount = chineseMatches ? chineseMatches.length : 0
            const totalLength = text.length

            // If the ratio of Han characters exceeds the threshold, this looks like Chinese text.
            // Exception: if the surrounding context contains Kana, the page is Japanese — don't suppress.
            // Japanese Kanji naturally has high Han ratio but belongs on a Japanese page.
            if (totalLength > 0 && chineseCount / totalLength > CHINESE_RATIO_THRESHOLD) {
                if (contextText && REGEX_KANA.test(contextText)) {
                    logger.debug("Allowing translation: Han ratio high but context has Kana → Japanese page")
                    return true
                }
                logger.debug("Suppressing translation: Target is Chinese and text is identified as Chinese", {
                    text: text.substring(0, 20) + "...",
                    ratio: chineseCount / totalLength,
                })
                return false
            }

            // 2. Check page's declared language (fast, synchronous, reliable when set)
            // Covers cases where the selected text is pure Latin but the page is Chinese.
            if (pageDeclaredLanguage === "zh") {
                logger.debug("Suppressing translation: Target is Chinese and page metadata declares Chinese", {
                    pageDeclaredLanguage,
                })
                return false
            }

            // 3. Check whether the surrounding context is Chinese-dominant.
            // A few Chinese characters (e.g. a translated link title on an otherwise English page)
            // should not suppress translation. Require a meaningful Han ratio instead.
            // Guard: if context contains Japanese Kana, it is a Japanese page — don't suppress.
            if (contextText && !REGEX_KANA.test(contextText)) {
                const contextChineseRatio = calculateHanRatioAgainstHanAndLatin(contextText)
                logger.debug("Chinese-target suppression context analysis", {
                    textSnippet: text.substring(0, 20) + "...",
                    pageDeclaredLanguage,
                    contextSnippet: contextText.substring(0, 60) + "...",
                    contextChineseRatio,
                    threshold: CONTEXT_CHINESE_RATIO_THRESHOLD,
                })
                if (contextChineseRatio >= CONTEXT_CHINESE_RATIO_THRESHOLD) {
                    logger.debug("Suppressing translation: Target is Chinese and context is Chinese-dominant", {
                        contextSnippet: contextText.substring(0, 20) + "...",
                        ratio: contextChineseRatio,
                    })
                    return false
                }
            }

            logger.debug("Allowing translation: Target is Chinese but no same-language suppression signal matched", {
                textSnippet: text.substring(0, 20) + "...",
                pageDeclaredLanguage,
            })
            return true
        }
        case "ja": {
            // Japanese: Suppress if text contains Kana (unique to Japanese)
            if (REGEX_KANA.test(text)) {
                logger.debug("Suppressing translation: Target is Japanese and text contains Kana")
                return false
            }
            return true
        }
        case "ko": {
            // Korean: Suppress if text contains Hangul
            if (REGEX_HANGUL.test(text)) {
                logger.debug("Suppressing translation: Target is Korean and text contains Hangul")
                return false
            }
            return true
        }
        case "ru": {
            // Russian: Suppress if text contains Cyrillic
            if (REGEX_CYRILLIC.test(text)) {
                logger.debug("Suppressing translation: Target is Russian and text contains Cyrillic")
                return false
            }
            return true
        }
        case "en": {
            // English: Do not suppress (as requested)
            return true
        }
        default: {
            // Other languages (es, fr, de, etc.)
            // Fast-path: check page's declared language before async detection
            if (getPageDeclaredLanguage() === tgtLang) {
                logger.debug(`Suppressing translation: Target is ${tgtLang} and page declares it via lang attribute`)
                return false
            }
            // Fallback: rely on async language detection if context is provided
            if (contextText && contextText.length > 0) {
                const { lang: detectedLang } = await detectSourceLanguageAsync(contextText)
                if (detectedLang === tgtLang) {
                    logger.debug(`Suppressing translation: Target is ${tgtLang} and context detected as ${detectedLang}`)
                    return false
                }
            }
            return true
        }
    }
}

function calculateHanRatioAgainstHanAndLatin(text: string): number {
    if (!text) return 0

    const hanCount = text.match(REGEX_HAN)?.length ?? 0
    const latinCount = text.match(REGEX_LATIN)?.length ?? 0
    const comparableCount = hanCount + latinCount

    if (comparableCount === 0) return 0
    return hanCount / comparableCount
}

function normalizeLanguageTag(tag: string | null | undefined): string {
    if (!tag) return ""
    return tag.toLowerCase().split("-")[0]?.trim() ?? ""
}

function normalizeLocaleMeta(content: string | null | undefined): string {
    if (!content) return ""

    const firstToken = content.split(",")[0]?.trim().toLowerCase() ?? ""
    if (!firstToken) return ""

    return firstToken.split(/[-_]/)[0]?.trim() ?? ""
}
