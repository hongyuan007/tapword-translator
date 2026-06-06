/**
 * DOM walker for full-page translation.
 * Recursively walks the DOM tree, labeling elements with data attributes
 * for later translation processing.
 */

import {
    WALKED_ATTRIBUTE,
    PARAGRAPH_ATTRIBUTE,
    BLOCK_ATTRIBUTE,
    INLINE_ATTRIBUTE,
    FORCE_BLOCK_TAGS,
} from '../constants';
import type { WalkResult, PageTranslateRange } from '../types';
import {
    isHTMLElement,
    isTextNode,
    isShallowInlineHTMLElement,
    isShallowBlockHTMLElement,
    isDontWalkIntoButTranslateAsChildElement,
    isDontWalkIntoAndDontTranslateAsChildElement,
    logSkipDecisionIfNeeded,
} from './filter';

// ============================================================
// Public API
// ============================================================

/**
 * Recursively walk and label a DOM element for translation.
 *
 * Sets data attributes on elements indicating their role:
 * - WALKED_ATTRIBUTE: marks element as visited in this walk session
 * - PARAGRAPH_ATTRIBUTE: element contains inline text children (translation unit)
 * - BLOCK_ATTRIBUTE: element is classified as block-level
 * - INLINE_ATTRIBUTE: element is classified as inline
 *
 * @param element - The root element to walk
 * @param walkId - Unique session ID (UUID) for this walk
 * @param range - Page translation range ("main" or "all")
 * @returns Walk result with forceBlock and isInlineNode flags
 */
export function walkAndLabelElement(
    element: HTMLElement,
    walkId: string,
    range: PageTranslateRange,
): WalkResult {
    // Step 1: Early exit for elements that should not be walked into
    if (isDontWalkIntoButTranslateAsChildElement(element)
        || isDontWalkIntoAndDontTranslateAsChildElement(element, range)) {
        logSkipDecisionIfNeeded(element, range);
        return { forceBlock: false, isInlineNode: false };
    }

    // Step 2: Mark this element as walked with the session UUID
    element.setAttribute(WALKED_ATTRIBUTE, walkId);

    // Step 3: Handle Shadow DOM — recurse into shadow root children
    if (element.shadowRoot) {
        for (const child of Array.from(element.shadowRoot.children)) {
            if (isHTMLElement(child)) {
                walkAndLabelElement(child, walkId, range);
            }
        }
    }

    let hasInlineNodeChild = false;
    let forceBlock = false;

    // Step 4: Filter valid child nodes (text nodes + walkable HTML elements)
    const validChildNodes = Array.from(element.childNodes).filter((child: ChildNode) => {
        if (child.nodeType === Node.TEXT_NODE) return true;
        if (isHTMLElement(child)) {
            return !isDontWalkIntoAndDontTranslateAsChildElement(child, range);
        }
        return false;
    });

    // Step 5: Iterate valid children — classify and recurse
    for (const child of validChildNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (child.textContent?.trim()) {
                hasInlineNodeChild = true;
            }
            continue;
        }

        if (isHTMLElement(child)) {
            if (isDontWalkIntoButTranslateAsChildElement(child)) {
                if (child.textContent?.trim()) {
                    hasInlineNodeChild = true;
                }
                continue;
            }

            const result = walkAndLabelElement(child, walkId, range);

            // forceBlock propagates upward from descendants
            forceBlock = forceBlock || result.forceBlock;

            if (result.isInlineNode) {
                hasInlineNodeChild = true;
            }
        }
    }

    // Step 6: If any inline child exists, mark as paragraph
    if (hasInlineNodeChild) {
        element.setAttribute(PARAGRAPH_ATTRIBUTE, '');
    }

    // Step 7: Check if this element itself forces block
    forceBlock = forceBlock || FORCE_BLOCK_TAGS.has(element.tagName);

    // Step 8: Skip empty elements (unless forceBlock)
    if (element.textContent?.trim() === '' && !forceBlock) {
        return { forceBlock: false, isInlineNode: false };
    }

    // Step 9: Determine and apply block/inline classification
    const isInlineNode = isShallowInlineHTMLElement(element);

    if (isShallowBlockHTMLElement(element) || forceBlock) {
        element.setAttribute(BLOCK_ATTRIBUTE, '');
    } else if (isInlineNode) {
        element.setAttribute(INLINE_ATTRIBUTE, '');
    }

    return { forceBlock, isInlineNode };
}

/**
 * Recursively extract text content from a node with whitespace normalization.
 *
 * - Text nodes: normalizes leading/trailing whitespace (preserves word boundaries)
 * - <br> elements: converted to newlines
 * - Don't-translate elements: excluded
 * - Don't-walk-but-translate elements (e.g. <code>): their text IS included
 *
 * @param node - The node to extract text from
 * @param range - Page translation range ("main" or "all")
 * @returns Normalized text content
 */
export function extractTextContent(
    node: HTMLElement | Text,
    range: PageTranslateRange,
): string {
    // Case 1: Text node — normalize whitespace
    if (isTextNode(node)) {
        return normalizeTextNodeWhitespace(node);
    }

    // Case 2: <br> → line break
    if (isHTMLElement(node) && node.tagName === 'BR') {
        return '\n';
    }

    // Case 3: Don't-translate-as-child elements → excluded from text
    if (isDontWalkIntoAndDontTranslateAsChildElement(node, range)) {
        return '';
    }

    // Case 4: Recurse into children
    const childNodes = Array.from(node.childNodes);
    return childNodes.reduce((text: string, child: Node): string => {
        if (isTextNode(child) || isHTMLElement(child)) {
            return text + extractTextContent(child, range);
        }
        return text;
    }, '');
}

// ============================================================
// Internal Helpers
// ============================================================

/** Leading/trailing whitespace regex: matches non-newline whitespace */
const NON_NEWLINE_WHITESPACE_REGEX = /[^\S\n]/;

/**
 * Normalize a text node's whitespace:
 * - Empty/whitespace-only → single space (preserves word boundaries)
 * - Non-empty → trim + conditional single-space padding for leading/trailing
 * - Newlines at boundaries are NOT converted to spaces
 */
function normalizeTextNodeWhitespace(node: Text): string {
    const text = node.textContent ?? '';
    const trimmed = text.trim();
    if (trimmed === '') return ' ';

    const leadingWs = text.slice(0, text.length - text.trimStart().length);
    const trailingWs = text.slice(text.trimEnd().length);
    const hasLeading = NON_NEWLINE_WHITESPACE_REGEX.test(leadingWs);
    const hasTrailing = NON_NEWLINE_WHITESPACE_REGEX.test(trailingWs);

    return (hasLeading ? ' ' : '') + trimmed + (hasTrailing ? ' ' : '');
}
