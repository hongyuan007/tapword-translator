/**
 * Page Language Checker — detects whether the current page's language
 * matches a given target language code. Used to suppress the floating
 * translation button on pages already in the user's target language.
 */

import * as loggerModule from '@/0_common/utils/logger';
import {
    normalizeLanguageTagFull as normalizeLangTag,
    normalizeLocaleMeta,
    isSameLanguage,
} from '@/0_common/utils/languageTagUtils';

const logger = loggerModule.createLogger('pageLanguageChecker');

// Minimum ratio of script-specific chars to classify a page as that language
const MIN_HAN_RATIO = 0.10;
const MIN_SCRIPT_COUNT = 20;

// Script regexes (unicode property escapes)
const REGEX_HAN = /\p{Script=Han}/gu;
const REGEX_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const REGEX_HANGUL = /\p{Script=Hangul}/u;
const REGEX_CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Detect the page's declared language from HTML metadata.
 * Returns a normalized full language code preserving subtags (e.g., "zh-cn", "zh-tw", "en", "ja").
 */
function getPageDeclaredLanguage(): string {
    if (typeof document === 'undefined') return '';

    const htmlLang = normalizeLangTag(document.documentElement.lang);
    if (htmlLang) return htmlLang;

    const xmlLang = normalizeLangTag(document.documentElement.getAttribute('xml:lang'));
    if (xmlLang) return xmlLang;

    const ogLocale = normalizeLocaleMeta(
        document.querySelector('meta[property="og:locale"]')?.getAttribute('content')
    );
    const contentLanguage = normalizeLocaleMeta(
        document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content')
    );

    // Only trust meta tags when they agree; conflicting signals are unreliable
    if (ogLocale && contentLanguage) {
        return ogLocale === contentLanguage ? ogLocale : '';
    }

    return ogLocale || contentLanguage || '';
}

/**
 * Sample the page body text and detect language from script presence.
 * Returns a normalized base language code, or empty string if inconclusive.
 */
function detectLanguageFromContent(): string {
    if (typeof document === 'undefined') return '';

    // Sample first 2000 characters of visible body text
    const sample = (document.body?.innerText ?? '').slice(0, 2000);
    if (!sample) return '';

    // Japanese: Kana is unique to Japanese
    if (REGEX_KANA.test(sample)) return 'ja';

    // Korean: Hangul is unique to Korean
    if (REGEX_HANGUL.test(sample)) return 'ko';

    // Russian: Cyrillic (could also be other Slavic languages, but good enough)
    if (REGEX_CYRILLIC.test(sample)) return 'ru';

    // Chinese: Han characters without Kana — use ratio check
    const hanMatches = sample.match(REGEX_HAN);
    const hanCount = hanMatches ? hanMatches.length : 0;
    if (hanCount >= MIN_SCRIPT_COUNT && hanCount / sample.length > MIN_HAN_RATIO) {
        return 'zh';
    }

    return '';
}

/**
 * Determine whether the current page's language matches the given target language.
 *
 * Uses two signals in order:
 * 1. HTML metadata (lang attribute, og:locale, content-language meta)
 * 2. Script-based content sampling (for CJK and Cyrillic scripts)
 *
 * @param targetLanguage - User's target translation language (e.g., "zh", "zh-Hant", "ja", "en")
 * @returns true if the page appears to be in the target language
 */
export function isPageLanguageSameAsTarget(targetLanguage: string): boolean {
    const tgt = (targetLanguage || '').toLowerCase();
    if (!tgt) return false;

    // Signal 1: declared language from metadata
    const declared = getPageDeclaredLanguage();
    if (declared) {
        const match = isSameLanguage(declared, tgt);
        logger.debug(`Page declared language: "${declared}", target: "${tgt}", match: ${match}`);
        return match;
    }

    // Signal 2: script-based content sampling
    const detected = detectLanguageFromContent();
    if (detected) {
        const match = isSameLanguage(detected, tgt);
        logger.debug(`Page detected language (content sampling): "${detected}", target: "${tgt}", match: ${match}`);
        return match;
    }

    logger.debug(`Page language undetermined, assuming not same as target: "${tgt}"`);
    return false;
}
