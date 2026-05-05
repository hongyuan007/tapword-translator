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
 */
function shouldSkipChineseTargetLanguageText(text: string, targetLanguage?: string): boolean {
    const normalizedTarget = (targetLanguage || '').toLowerCase().split(/[-_]/)[0] ?? '';
    if (normalizedTarget !== CHINESE_TARGET_LANG) return false;

    const trimmed = text.trim();
    if (!trimmed) return false;
    if (REGEX_KANA.test(trimmed) || REGEX_HANGUL.test(trimmed)) return false;

    const hanCount = trimmed.match(REGEX_HAN)?.length ?? 0;
    if (hanCount < CHINESE_TARGET_MIN_HAN_COUNT) return false;

    const latinCount = trimmed.match(REGEX_LATIN)?.length ?? 0;
    if (latinCount === 0) return true;

    const comparableCount = hanCount + latinCount;
    const hanRatio = comparableCount === 0 ? 0 : hanCount / comparableCount;
    return hanCount >= CHINESE_TARGET_DOMINANT_MIN_HAN_COUNT
        && hanRatio >= CHINESE_TARGET_DOMINANT_HAN_RATIO;
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
