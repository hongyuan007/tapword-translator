/**
 * Language Validator Utility
 *
 * Validates text content against target language settings to determine if translation is necessary.
 * Handles "Native Speaker Suppression" logic.
 */
import * as loggerModule from "@/0_common/utils/logger"
import { detectSourceLanguageAsync } from "@/1_content/utils/languageDetector"
import {
    normalizeLanguageTagFull,
    normalizeLocaleMeta,
    getMainSubtag,
    isSameLanguage,
} from "@/0_common/utils/languageTagUtils"

const logger = loggerModule.createLogger("languageValidator")

const CHINESE_RATIO_THRESHOLD = 0.05
const CONTEXT_CHINESE_RATIO_THRESHOLD = 0.10

function getPageDeclaredLanguage(): string {
    if (typeof document === "undefined") return ""

    const htmlLang = normalizeLanguageTagFull(document.documentElement.lang)
    if (htmlLang) {
        return htmlLang
    }

    const xmlLang = normalizeLanguageTagFull(document.documentElement.getAttribute("xml:lang"))
    if (xmlLang) {
        return xmlLang
    }

    const ogLocale = normalizeLocaleMeta(document.querySelector('meta[property="og:locale"]')?.getAttribute("content"))
    const contentLanguage = normalizeLocaleMeta(document.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content"))

    if (ogLocale && contentLanguage) {
        // Only trust meta tags when they agree; conflicting signals are unreliable
        return ogLocale === contentLanguage ? ogLocale : ""
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
 *   For zh-Hant (Traditional Chinese), we differentiate between Simplified and Traditional script.
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
    const tgtLang = (targetLanguage || "").toLowerCase() // Only lowercase, do NOT split
    const pageDeclaredLanguage = getPageDeclaredLanguage()

    // Determine the primary language subtag for switch dispatch
    const tgtMain = getMainSubtag(tgtLang)

    switch (tgtMain) {
        case "zh": {
            // 1. Check for Japanese Kana first
            if (REGEX_KANA.test(text)) {
                return true // It's likely Japanese, so show translation for Chinese user
            }

            // 2. Check page's declared language FIRST (before text analysis)
            // This handles the case where the page declares zh-TW/zh-Hant and target is zh-Hant,
            // even if the selected text itself is script-neutral (e.g., "你好世界").
            if (pageDeclaredLanguage && isSameLanguage(pageDeclaredLanguage, tgtLang)) {
                logger.debug("Suppressing translation: page metadata declares same Chinese variant", {
                    pageDeclaredLanguage,
                    tgtLang,
                })
                return false
            }

            // 3. Check if the selection ITSELF is Chinese
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
                // Detect the script variant of the selected text to differentiate Simplified vs Traditional
                const textScript = detectChineseScript(text)
                const textLang = textScript === "traditional" ? "zh-Hant" : "zh"
                if (isSameLanguage(textLang, tgtLang)) {
                    logger.debug("Suppressing translation: Target matches text language (same Chinese variant)", {
                        text: text.substring(0, 20) + "...",
                        ratio: chineseCount / totalLength,
                        textScript,
                        tgtLang,
                    })
                    return false
                }
                // Text is Chinese but different script variant from target
                logger.debug("Allowing translation: Chinese text but different script variant", {
                    text: text.substring(0, 20) + "...",
                    textScript,
                    tgtLang,
                })
                return true
            }

            // 4. Check whether the surrounding context is Chinese-dominant.
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
                    // Detect script of context text to differentiate Simplified vs Traditional
                    const contextScript = detectChineseScript(contextText)
                    const contextLang = contextScript === "traditional" ? "zh-Hant" : "zh"
                    if (isSameLanguage(contextLang, tgtLang)) {
                        logger.debug("Suppressing translation: Target is Chinese and context is Chinese-dominant (same variant)", {
                            contextSnippet: contextText.substring(0, 20) + "...",
                            ratio: contextChineseRatio,
                            contextScript,
                        })
                        return false
                    }
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
            if (pageDeclaredLanguage && isSameLanguage(pageDeclaredLanguage, tgtLang)) {
                logger.debug(`Suppressing translation: Target is ${tgtMain} and page declares it via lang attribute`)
                return false
            }
            // Fallback: rely on async language detection if context is provided
            if (contextText && contextText.length > 0) {
                const { lang: detectedLang } = await detectSourceLanguageAsync(contextText)
                if (detectedLang === tgtMain) {
                    logger.debug(`Suppressing translation: Target is ${tgtMain} and context detected as ${detectedLang}`)
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

/**
 * A set of characters that only appear in Traditional Chinese (not in Simplified).
 * Used as a heuristic to detect if Chinese text is traditional or simplified.
 * Not exhaustive but covers the most common discriminating characters.
 */
const TRADITIONAL_ONLY_CHARS = new Set(
    ("愛礙罷備筆畢邊變標佈測廠場暢車陳塵遲醜從達帶單當黨導敵電釣東動獨頓發罰煩訪費廢奮複負蓋幹剛綱個給宮貢構購穀顧僱掛廣歸龜貴國號轟鴻後護劃懷壞歡還匯會渾獲貨禍擊機積飢膚雞級幾計記際劑濟夾鉀價駕堅鉛儉劍漸礁膠腳較節莖驚經頸競舊劇據鋸覺決殼塊寬礦曠況虧來賴藍攔欄覽勞澇樂離禮歷勵隸連憐蓮聯鐮倆糧兩遼裂獵臨鄰靈領嶺劉陸錄慮論腦鬧釀鳥農盤龐賠噴騙貧評撲鋪樸氣遷僑橋竊欽親輕慶區權勸熱認灑傘喪掃澀殺曬閃陝賞燒設審聲勝聖詩時識實適釋壽書術樹雙誰絲鬆蘇雖隨歲損鎖態嘆討騰體塗團脫馱彎萬網衛穩務烏無膽鐘轉壯狀齊維穢濁興譽軒選學醫郵魚圓緣遠雲雜災髒戰張趙鎮爭鄭證織職執質滯種眾軸駐專莊裝髮準濟").split("")
)

/**
 * Detect whether Chinese text uses Traditional or Simplified characters.
 * Uses a heuristic: if any character in the text is a known Traditional-only character,
 * the text is classified as Traditional.
 *
 * @param text - Chinese text to analyze
 * @returns "traditional", "simplified", or "unknown" (empty/no Han chars)
 */
function detectChineseScript(text: string): "traditional" | "simplified" | "unknown" {
    if (!text) return "unknown"
    for (const char of text) {
        if (TRADITIONAL_ONLY_CHARS.has(char)) {
            return "traditional"
        }
    }
    return "simplified"
}
