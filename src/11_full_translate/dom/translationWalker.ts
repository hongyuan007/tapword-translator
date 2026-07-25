/**
 * Translation walker — processes walked/labeled paragraphs for translation.
 * Extracts text from paragraph elements and validates translation eligibility.
 * Groups consecutive inline children into separate translation units.
 */

import type { PageTranslateRange, TranslationUnit } from '../types';
import { INLINE_ATTRIBUTE, BLOCK_ATTRIBUTE } from '../constants';
import {
    isHTMLElement,
    isTextNode,
    isTranslatedWrapperNode,
    isShallowInlineTransNode,
    isNumericContent,
} from './filter';
import { extractTextContent } from './walker';

// Re-export TranslationUnit for consumers importing from this module
export type { TranslationUnit } from '../types';

const REGEX_HAN = /\p{Script=Han}/gu;
const REGEX_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const REGEX_HANGUL = /\p{Script=Hangul}/u;
const REGEX_LATIN = /\p{Script=Latin}/gu;
const CHINESE_TARGET_LANG = 'zh';
const CHINESE_TARGET_MIN_HAN_COUNT = 2;
const CHINESE_TARGET_DOMINANT_MIN_HAN_COUNT = 8;
const CHINESE_TARGET_DOMINANT_HAN_RATIO = 0.9;

// ============================================================
// Public API
// ============================================================

/**
 * Process a paragraph element and extract translation units.
 * Groups consecutive inline children into separate translation units.
 * Block children are NOT included — they will be processed separately as their own paragraphs.
 */
export function extractTranslationUnits(
    paragraphElement: HTMLElement,
    range: PageTranslateRange,
): TranslationUnit[] {
    const units: TranslationUnit[] = [];
    let currentInlineNodes: Node[] = [];

    // P0-1 + P0-2: Detect block children and flex parent
    let hasBlockChild = false;
    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
            hasBlockChild = true;
            break;
        }
    }

    // P0-2: Flex parent detection — only check when block children exist
    const isFlexParent = hasBlockChild
        ? window.getComputedStyle(paragraphElement).display.includes('flex')
        : false;

    // P0-3: forceBlockTranslation = hasBlockChild && !isFlexParent
    const forceBlock = hasBlockChild && !isFlexParent;

    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isTextNode(child) && child.textContent?.trim()) {
            currentInlineNodes.push(child);
        } else if (isHTMLElement(child)) {
            if (isTranslatedWrapperNode(child)) {
                continue;
            }

            if (child.hasAttribute(BLOCK_ATTRIBUTE)) {
                // Block child — flush current inline group
                flushInlineGroup(currentInlineNodes, range, units, forceBlock);
                currentInlineNodes = [];
                // Block children are NOT added to units — processed recursively
            } else if (child.hasAttribute(INLINE_ATTRIBUTE) || isShallowInlineTransNode(child)) {
                currentInlineNodes.push(child);
            } else {
                // Unknown — treat as block boundary
                flushInlineGroup(currentInlineNodes, range, units, forceBlock);
                currentInlineNodes = [];
            }
        }
    }

    // Flush remaining inline nodes
    flushInlineGroup(currentInlineNodes, range, units, forceBlock);

    return units;
}

/**
 * Extract translatable text from a paragraph element.
 * Convenience wrapper over extractTranslationUnits — joins all unit texts.
 */
export function extractParagraphText(
    paragraphElement: HTMLElement,
    range: PageTranslateRange,
): string {
    const units = extractTranslationUnits(paragraphElement, range);
    return units.map(u => u.text).join(' ');
}

/**
 * Check if a paragraph meets minimum text requirements for translation.
 * Returns false for empty text, purely numeric content, or text below thresholds.
 */
export function shouldTranslateParagraph(
    text: string,
    minChars: number,
    minWords: number,
    targetLanguage?: string,
): boolean {
    if (!text.trim()) return false;
    if (isNumericContent(text)) return false;
    if (shouldSkipChineseTargetLanguageText(text, targetLanguage)) return false;
    if (minChars > 0 && text.length < minChars) return false;
    if (minWords > 0) {
        const wordCount = text.trim().split(/\s+/).length;
        if (wordCount < minWords) return false;
    }
    return true;
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Chinese-target optimization for full-page translation.
 * Skips blocks that are already clearly Chinese, while mixed-language blocks
 * still go to the backend so the model can translate the non-Chinese parts.
 *
 * For zh-Hant target: only skip text that is already Traditional Chinese.
 * Simplified or script-neutral text should still be translated (simp→trad).
 */
function shouldSkipChineseTargetLanguageText(text: string, targetLanguage?: string): boolean {
    const normalizedTarget = (targetLanguage || '').toLowerCase().split(/[-_]/)[0] ?? '';
    if (normalizedTarget !== CHINESE_TARGET_LANG) return false;

    // For Traditional Chinese target, don't skip text that might be Simplified.
    // The full-page translator should handle both directions (simp→trad and trad→simp).
    // Only skip text that is clearly already in the target script.
    // For now, keep the original behavior for plain "zh" target,
    // but for "zh-Hant", only skip if the text contains Traditional characters.
    const fullTarget = (targetLanguage || '').toLowerCase();
    const isTraditionalTarget = fullTarget.includes('hant') ||
                                fullTarget.includes('tw') ||
                                fullTarget.includes('hk');

    const trimmed = text.trim();
    if (!trimmed) return false;
    if (REGEX_KANA.test(trimmed) || REGEX_HANGUL.test(trimmed)) return false;

    const hanCount = trimmed.match(REGEX_HAN)?.length ?? 0;
    if (hanCount < CHINESE_TARGET_MIN_HAN_COUNT) return false;

    // For zh-Hant target: only skip if text is already Traditional
    if (isTraditionalTarget) {
        // Check if text contains any Traditional-only characters
        const hasTraditional = checkHasTraditionalChars(trimmed);
        if (hasTraditional) return true;  // Already traditional, skip
        // Text is simplified or neutral — don't skip, needs translation
        return false;
    }

    // For plain zh target: original behavior
    const latinCount = trimmed.match(REGEX_LATIN)?.length ?? 0;
    if (latinCount === 0) return true;

    const comparableCount = hanCount + latinCount;
    const hanRatio = comparableCount === 0 ? 0 : hanCount / comparableCount;
    return hanCount >= CHINESE_TARGET_DOMINANT_MIN_HAN_COUNT
        && hanRatio >= CHINESE_TARGET_DOMINANT_HAN_RATIO;
}

// Traditional Chinese indicator characters (subset for quick check)
const TRADITIONAL_INDICATOR_CHARS = new Set("愛礙罷備筆畢邊變標佈測廠場暢車陳塵遲醜從達帶單當黨導敵電釣東動獨頓發罰煩訪費廢奮複負蓋幹剛綱個給宮貢構購穀顧僱掛廣歸龜貴國號轟鴻後護劃懷壞歡還匯會渾獲貨禍擊機積飢膚雞級幾計記際劑濟夾鉀價駕堅鉛儉劍漸礁膠腳較節莖驚經頸競舊劇據鋸覺決殼塊寬礦曠況虧來賴藍攔欄覽勞澇樂離禮歷勵隸連憐蓮聯鐮倆糧兩遼裂獵臨鄰靈領嶺劉陸錄慮論腦鬧釀鳥農盤龐賠噴騙貧評撲鋪樸氣遷僑橋竊欽親輕慶區權勸熱認灑傘喪掃澀殺曬閃陝賞燒設審聲勝聖詩時識實適釋壽書術樹雙誰絲鬆蘇雖隨歲損鎖態嘆討騰體塗團脫馱彎萬網衛穩務烏無膽鐘轉壯狀齊維穢濁興譽軒選學醫郵魚圓緣遠雲雜災髒戰張趙鎮爭鄭證織職執質滯種眾軸駐專莊裝髮準濟".split(""))

function checkHasTraditionalChars(text: string): boolean {
    for (const char of text) {
        if (TRADITIONAL_INDICATOR_CHARS.has(char)) return true
    }
    return false
}

/** Flush accumulated inline nodes into a TranslationUnit if they have text content */
function flushInlineGroup(
    nodes: Node[],
    range: PageTranslateRange,
    units: TranslationUnit[],
    forceBlockTranslation: boolean = false,
): void {
    if (nodes.length === 0) return;

    const text = nodes
        .map(n => extractTextContent(n as HTMLElement | Text, range))
        .join('')
        .trim();

    if (text) {
        units.push({ nodes: [...nodes], text, forceBlockTranslation });
    }
}

/**
 * Collect direct block children of a paragraph element.
 * These need to be recursively processed as independent paragraphs.
 */
export function collectBlockChildren(paragraphElement: HTMLElement): HTMLElement[] {
    const blockChildren: HTMLElement[] = [];
    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
            blockChildren.push(child);
        }
    }
    return blockChildren;
}
