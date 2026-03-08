/**
 * Language Detection Utility
 *
 * Prefer Chrome's built-in detector, then fallback to franc-min.
 * Keep sync API as a minimal fallback only.
 */
import * as loggerModule from "@/0_common/utils/logger"
import { franc } from "franc-min"

const logger = loggerModule.createLogger("languageDetector")

// Short pure-ASCII text (≤10 chars, no CJK) is almost certainly English for our primary
// demographic (Chinese users reading English content). Chrome's statistical detector is
// unreliable at this length (e.g., "nominated" → "la"). Skip the API call entirely.
const SHORT_ASCII_THRESHOLD = 10
const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]+$/

/**
 * Detect the source language of the given text using async language detection.
 * Prefer Chrome's built-in detector, then fallback to franc-min.
 *
 * @param text - The text to detect language for
 * @returns Language code (e.g., 'en', 'zh', 'es')
 */
/**
 * Result of async language detection.
 * `lang` is the effective routing language (may be "auto" for mixed CJK+Latin content).
 * `blockContextLang` is the original detected language (before "auto" override), validated with
 * a Kana check for Japanese: if Chrome detects "ja" but no Kana is present in the text, it falls
 * back to `lang`. This guards against rare Chrome false-positives on CJK text that could
 * incorrectly disable the zh→en same-language fallback in resolveTargetLanguage.
 */
export interface LanguageDetectionResult {
    lang: string
    blockContextLang: string
}

export async function detectSourceLanguageAsync(text: string): Promise<LanguageDetectionResult> {
    logger.debug("Starting async language detection:", text)
    const trimmed = (text || "").trim()
    const fallback = "en"
    if (trimmed.length === 0) return { lang: fallback, blockContextLang: fallback }

    if (trimmed.length <= SHORT_ASCII_THRESHOLD && PRINTABLE_ASCII_REGEX.test(trimmed)) {
        logger.debug(`Short ASCII text (${trimmed.length} chars) → assuming "en"`)
        return { lang: "en", blockContextLang: "en" }
    }

    let detectedLang = fallback
    let isDetected = false

    try {
        if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.detectLanguage === "function") {
            logger.debug("Using chrome.i18n.detectLanguage")
            const result = await new Promise<chrome.i18n.LanguageDetectionResult>((resolve) => {
                chrome.i18n.detectLanguage(trimmed.slice(0, 1200), (res) => resolve(res))
            })
            if (result && Array.isArray(result.languages) && result.languages.length > 0) {
                const top = result.languages[0]
                if (top && top.language) {
                    const norm = normalizeLangCode(top.language)
                    if (norm) {
                        logger.debug(`Chrome detected language: ${norm}`)
                        detectedLang = norm
                        isDetected = true
                    }
                }
            }
        }
    } catch (error) {
        logger.error("chrome.i18n.detectLanguage failed, falling back to franc", error)
    }

    if (!isDetected) {
        try {
            logger.debug("Using franc for language detection")
            const iso3 = franc(trimmed, { minLength: 3 })
            if (iso3 && iso3 !== "und") {
                const iso1 = iso3to1(iso3)
                if (iso1) {
                    logger.debug(`Franc detected language: ${iso1}`)
                    detectedLang = iso1
                    isDetected = true
                }
            }
        } catch (error) {
            logger.error("Franc detection failed", error)
        }
    }

    if (!isDetected) {
        logger.debug(`Falling back to default language: ${fallback}`)
    }

    // Preserve the detected language before the "auto" override for Kana validation below.
    const rawLang = detectedLang

    // Post-processing optimization specifically for our primary demographic:
    // Chinese users reading English (or other Latin-script) content.
    if (["zh", "ja", "ko"].includes(detectedLang)) {
        const hasCJK = hasCJKCharacters(trimmed)
        const hasLatin = /[a-zA-Z]/.test(trimmed)

        if (!hasCJK && hasLatin) {
            // False positive: Detector claims CJK, but text only has Latin characters (no CJK).
            // Example: short English words like "having", "influence" misidentified as "ko" or "zh".
            logger.info(`Correcting false positive CJK detection (${detectedLang}) -> 'en'`)
            detectedLang = "en"
        } else if (hasCJK && hasLatin) {
            // Mixed content: Text has both CJK and Latin characters (e.g. "you什么时候来", "CPU速度").
            // We use "auto" so the Translation Pipeline doesn't trigger same-language fallbacks
            // and lets the backend LLM handle the code-switching.
            logger.info(`Treating mixed CJK/Latin text as 'auto' instead of ${detectedLang}`)
            detectedLang = "auto"
        }
    }

    // blockContextLang: rawLang validated for Japanese — if rawLang is "ja" but no Kana is present,
    // fall back to lang. This guards against Chrome misclassifying CJK-heavy text as Japanese,
    // which would incorrectly disable the zh→en same-language fallback in resolveTargetLanguage.
    const blockContextLang = (rawLang === "ja" && !/[\u3040-\u30FF]/.test(trimmed)) ? detectedLang : rawLang
    logger.info(`Language detection result: lang=${detectedLang}, rawLang=${rawLang}, blockContextLang=${blockContextLang}`)

    return { lang: detectedLang, blockContextLang }
}

function normalizeLangCode(code: string): string | null {
    if (!code) return null
    const parts = code.toLowerCase().split("-")
    const primary = parts.length > 0 ? parts[0] : ""
    switch (primary) {
        case "zh":
            return "zh"
        case "en":
            return "en"
        case "ja":
            return "ja"
        case "ko":
            return "ko"
        case "ru":
            return "ru"
        case "ar":
            return "ar"
        case "el":
            return "el"
        case "he":
            return "he"
        case "th":
            return "th"
        case "hi":
            return "hi"
        case "es":
            return "es"
        case "fr":
            return "fr"
        case "de":
            return "de"
        case "pt":
            return "pt"
        case "it":
            return "it"
        case "nl":
            return "nl"
        case "vi":
            return "vi"
        case "tr":
            return "tr"
        case "pl":
            return "pl"
        case "ro":
            return "ro"
        default:
            return primary || null
    }
}

function iso3to1(code: string): string | null {
    const map: Record<string, string> = {
        eng: "en",
        zho: "zh",
        cmn: "zh",
        jpn: "ja",
        kor: "ko",
        rus: "ru",
        ara: "ar",
        ell: "el",
        heb: "he",
        tha: "th",
        hin: "hi",
        spa: "es",
        fra: "fr",
        fre: "fr",
        deu: "de",
        ger: "de",
        por: "pt",
        ita: "it",
        nld: "nl",
        dut: "nl",
        vie: "vi",
        tur: "tr",
        pol: "pl",
        ron: "ro",
        rum: "ro",
        ukr: "uk",
        ces: "cs",
        cze: "cs",
        slk: "sk",
        slo: "sk",
        swe: "sv",
        dan: "da",
        nor: "no",
        fin: "fi",
    }
    const lower = (code || "").toLowerCase()
    return map[lower] || null
}

/**
 * Resolves the actual target language to use for translation.
 * If the source language matches the target language, automatically switch to a fallback:
 * - Chinese (zh) -> English (en)
 * - English (en) -> Japanese (ja)
 * - Other languages -> English (en)
 *
 * @param sourceLanguage - The detected source language code
 * @param targetLanguage - The user's preferred target language code
 * @returns The resolved target language code to use for translation
 */
export function resolveTargetLanguage(sourceLanguage: string, targetLanguage: string, blockContextLang?: string): string {
    // Normalize to lowercase for comparison
    const srcLang = (sourceLanguage || "").toLowerCase()
    const tgtLang = (targetLanguage || "").toLowerCase()
    const blockLang = (blockContextLang || "").toLowerCase()

    // If source is "auto" (code-switching text), skip fallback and trust user's target language.
    // Let the backend LLM decide how to handle mixed-language input.
    if (srcLang === "auto") {
        logger.info(`Source language is "auto", skipping fallback, using target: ${targetLanguage}`)
        return targetLanguage
    }

    // Special case: pure-Kanji Japanese words contain no Kana and are script-indistinguishable
    // from Chinese by Unicode range alone. If the block context (150 chars) has already
    // identified the surrounding page as Japanese, trust that over the "zh" script guess to
    // prevent a spurious zh→en fallback on Japanese pages.
    const effectiveSrc = (srcLang === "zh" && blockLang === "ja") ? "ja" : srcLang
    if (effectiveSrc !== srcLang) {
        logger.info(`Block context (${blockLang}) overrides script-based source "${srcLang}" → "${effectiveSrc}"`)
    }

    // If source and target are the same, apply fallback rules
    if (effectiveSrc === tgtLang) {
        logger.info(`Source language (${effectiveSrc}) matches target language (${tgtLang}), applying fallback`)

        if (effectiveSrc === "zh") {
            // Chinese content with Chinese target -> English
            logger.info("Chinese -> English fallback applied")
            return "en"
        } else if (effectiveSrc === "en") {
            // English content with English target -> Japanese
            logger.info("English -> Japanese fallback applied")
            return "ja"
        } else {
            // Other languages -> English
            logger.info(`${effectiveSrc} -> English fallback applied`)
            return "en"
        }
    }

    // No conflict, use original target language
    return targetLanguage
}

/**
 * Checks if the text contains any CJK (Chinese, Japanese, Korean) characters.
 * Used to robustly determine if the CJK fragmentation path should be used,
 * avoiding false positives from language detectors on short non-CJK words.
 *
 * @param text - The text to check
 * @returns True if CJK characters are found
 */
export function hasCJKCharacters(text: string): boolean {
    // Range includes:
    // \u4e00-\u9fff: CJK Unified Ideographs (Common Chinese)
    // \u3400-\u4dbf: CJK Unified Ideographs Extension A
    // \u3040-\u30ff: Hiragana and Katakana (Japanese)
    // \uac00-\ud7af: Hangul Syllables (Korean)
    // \u3130-\u318f: Hangul Compatibility Jamo
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\u3130-\u318f]/
    return cjkRegex.test(text)
}

/**
 * Synchronously infers the primary script language of a text without any API call.
 * Used to determine same-language fallback based on the *selected text* rather than
 * the broader block context (which may return "auto" for mixed CJK+Latin content).
 *
 * Priority order: Japanese Kana → Korean Hangul → Cyrillic → Chinese Han
 *
 * @param text - The selected text
 * @returns A BCP-47 language tag if a definitive script is found, or null for Latin/ambiguous text
 */
export function detectSelectionScriptLang(text: string): "zh" | "ja" | "ko" | "ru" | null {
    if (/[\u3040-\u30ff]/.test(text)) return "ja"        // Hiragana / Katakana → Japanese
    if (/[\uac00-\ud7af\u3130-\u318f]/.test(text)) return "ko" // Hangul → Korean
    if (/[\u0400-\u04ff]/.test(text)) return "ru"        // Cyrillic → Russian
    // Only return "zh" for pure CJK text (no Latin letters).
    // Mixed CJK+Latin selections (e.g. "所有memory md全空") should fall back to
    // the block-context "auto" value so the LLM translates the English parts to Chinese.
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)
    const hasLatin = /[a-zA-Z]/.test(text)
    if (hasCJK && !hasLatin) return "zh"
    return null
}
