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
): boolean {
    if (!text.trim()) return false;
    if (isNumericContent(text)) return false;
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
