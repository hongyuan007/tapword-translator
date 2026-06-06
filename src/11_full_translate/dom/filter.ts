/**
 * DOM filter/detection functions for full-page translation.
 * Determines which elements to walk, skip, or classify as block/inline.
 */

import * as loggerModule from '@/0_common/utils/logger';
import {
    FORCE_BLOCK_TAGS,
    FORCE_INLINE_TRANSLATION_TAGS,
    DONT_WALK_AND_TRANSLATE_TAGS,
    DONT_WALK_BUT_TRANSLATE_TAGS,
    NOTRANSLATE_CLASS,
    CONTENT_WRAPPER_CLASS,
    MAIN_CONTENT_IGNORE_TAGS,
    CUSTOM_FORCE_BLOCK_SELECTORS,
    CUSTOM_DONT_WALK_SELECTORS,
    EXTENSION_OWNED_ATTRIBUTE,
} from '../constants';
import type { TransNode, PageTranslateRange } from '../types';

const logger = loggerModule.createLogger('FullTranslate/filter');
const loggedSkipDecisionKeys = new Set<string>();

type SkipDecision = {
    shouldSkip: boolean;
    reasons: string[];
};

// ============================================================
// Public API
// ============================================================

/** Duck-typed HTMLElement check (works across iframes and shadow DOMs) */
export function isHTMLElement(node: Node): node is HTMLElement {
    return node.nodeType === Node.ELEMENT_NODE
        && node.nodeName !== undefined
        && 'tagName' in node
        && 'getAttribute' in node
        && 'setAttribute' in node;
}

/** Text node type guard */
export function isTextNode(node: Node): node is Text {
    return node.nodeType === Node.TEXT_NODE
        && 'textContent' in node
        && 'data' in node;
}

/** TransNode = HTMLElement | Text */
export function isTransNode(node: Node): node is TransNode {
    return isHTMLElement(node) || isTextNode(node);
}

/**
 * Shallow inline check for TransNode — text nodes with content or inline HTML elements.
 * "Shallow" means only the node itself is inspected, not its children.
 */
export function isShallowInlineTransNode(node: Node): boolean {
    if (isTextNode(node) && node.textContent?.trim()) {
        return true;
    }
    if (isHTMLElement(node)) {
        return isShallowInlineHTMLElement(node);
    }
    return false;
}

/**
 * Shallow inline check for HTMLElement.
 * Returns true when: non-empty text, not a force-block tag, CSS display is inline-family.
 * Also handles floating drop-cap letters.
 */
export function isShallowInlineHTMLElement(element: HTMLElement): boolean {
    if (!element.textContent?.trim()) return false;
    if (FORCE_BLOCK_TAGS.has(element.tagName)) return false;

    const computedStyle = window.getComputedStyle(element);
    if (isLargeInitialFloatingLetter(element)) return true;

    return isInlineDisplay(computedStyle.display);
}

/**
 * Shallow block check for HTMLElement.
 * Returns true when: force-block tag OR CSS display is not inline-family.
 */
export function isShallowBlockHTMLElement(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element);

    if (FORCE_BLOCK_TAGS.has(element.tagName)) return true;
    if (isLargeInitialFloatingLetter(element)) return false;

    return !isInlineDisplay(computedStyle.display);
}

/**
 * Element should NOT be walked into, but its text IS included in parent translation.
 * Applies to: .notranslate class, <code>, <time> tags.
 */
export function isDontWalkIntoButTranslateAsChildElement(element: HTMLElement): boolean {
    return element.classList.contains(NOTRANSLATE_CLASS)
        || DONT_WALK_BUT_TRANSLATE_TAGS.has(element.tagName);
}

/**
 * Element should NOT be walked into AND its text is excluded from translation.
 * Checks: custom selectors, main-content filter, invalid tags, CSS hidden, aria-hidden, etc.
 */
export function isDontWalkIntoAndDontTranslateAsChildElement(
    element: HTMLElement,
    range: PageTranslateRange,
): boolean {
    return getSkipDecision(element, range).shouldSkip;
}

/**
 * Check if element matches a site-specific force-block translation selector.
 * Uses hostname-based lookup from CUSTOM_FORCE_BLOCK_SELECTORS.
 */
export function isCustomForceBlockTranslation(element: HTMLElement): boolean {
    const selectors = CUSTOM_FORCE_BLOCK_SELECTORS[window.location.hostname] ?? [];
    const joined = selectors.join(',');
    if (!joined) return false;
    return element.matches(joined);
}

/**
 * Check if element matches a site-specific dont-walk-into selector.
 * Uses hostname-based lookup from CUSTOM_DONT_WALK_SELECTORS.
 */
export function isCustomDontWalkIntoElement(element: HTMLElement): boolean {
    const selectors = CUSTOM_DONT_WALK_SELECTORS[window.location.hostname] ?? [];
    const joined = selectors.join(',');
    if (!joined) return false;
    return element.matches(joined);
}

/**
 * Check if element should force inline translation insertion.
 * Returns true when: tag is in FORCE_INLINE_TRANSLATION_TAGS whitelist, OR element is a flex container.
 * This protects flex layouts from being broken by block-level separators.
 */
export function isForceInlineTranslation(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element);
    return FORCE_INLINE_TRANSLATION_TAGS.has(element.tagName)
        || computedStyle.display.includes('flex');
}

/** Check if node is a translated content wrapper injected by us */
export function isTranslatedWrapperNode(node: Node): boolean {
    return isHTMLElement(node)
        && node.classList.contains(CONTENT_WRAPPER_CLASS);
}

/**
 * Check if text content is purely numeric (digits, spaces, commas, dots, hyphens).
 * Such content doesn't need translation.
 */
export function isNumericContent(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Must contain at least one digit, and consist only of digits, whitespace, commas, dots, hyphens
    return /\d/.test(trimmed) && /^[\d\s,.\-]+$/.test(trimmed);
}

/**
 * Walk up ancestor chain to check if any ancestor is a "don't walk" element.
 * Used by MutationObserver to decide whether newly added elements should be processed.
 */
export function hasNoWalkAncestor(element: HTMLElement, range: PageTranslateRange): boolean {
    let current: HTMLElement | null = element.parentElement;
    while (current) {
        if (isDontWalkIntoButTranslateAsChildElement(current)
            || isDontWalkIntoAndDontTranslateAsChildElement(current, range)) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

/** Emit a one-time debug log when a meaningful subtree is skipped by the walker. */
export function logSkipDecisionIfNeeded(
    element: HTMLElement,
    range: PageTranslateRange,
): void {
    const decision = getSkipDecision(element, range);
    if (!decision.shouldSkip) return;
    if (!shouldLogSkipDecision(element, decision, range)) return;

    const key = `${decision.reasons.join('|')}::${buildElementPath(element)}`;
    if (loggedSkipDecisionKeys.has(key)) return;

    loggedSkipDecisionKeys.add(key);
    logger.debug('[walk-skip]', {
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 120),
        reasons: decision.reasons,
        range,
        path: buildElementPath(element),
    });
}

/**
 * querySelectorAll that also traverses shadow DOM trees.
 * Collects matching elements from both light DOM and shadow roots recursively.
 */
export function deepQuerySelectorAll(root: Element | Document | ShadowRoot, selector: string): HTMLElement[] {
    const results: HTMLElement[] = [];

    // Query direct descendants in this root
    const matches = root.querySelectorAll<HTMLElement>(selector);
    results.push(...Array.from(matches));

    // Recurse into shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of Array.from(allElements)) {
        if (el.shadowRoot) {
            results.push(...deepQuerySelectorAll(el.shadowRoot, selector));
        }
    }

    return results;
}

// ============================================================
// Internal Helpers
// ============================================================

function getSkipDecision(
    element: HTMLElement,
    range: PageTranslateRange,
): SkipDecision {
    // Extension-owned UI element — skip entirely
    if (element.hasAttribute(EXTENSION_OWNED_ATTRIBUTE)) {
        return { shouldSkip: true, reasons: ['extension-owned'] };
    }

    const reasons: string[] = [];

    // The "main" range remains as a reserved capability.
    // Current production behavior is controlled at the entrypoint, which now defaults to "all".
    if (range !== 'all'
        && MAIN_CONTENT_IGNORE_TAGS.has(element.tagName)
        && !isInsideContentContainer(element)) {
        reasons.push('main-content-ignore-tag');
    }

    if (DONT_WALK_AND_TRANSLATE_TAGS.has(element.tagName)) {
        reasons.push('dont-walk-tag');
    }

    if (isCustomDontWalkIntoElement(element)) {
        reasons.push('custom-dont-walk-selector');
    }

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        reasons.push('css-hidden');
    }

    if (element.hidden) {
        reasons.push('hidden-attribute');
    }

    if (element.getAttribute('aria-hidden') === 'true') {
        reasons.push('aria-hidden');
    }

    if (['sr-only', 'visually-hidden'].some(cls => element.classList.contains(cls))) {
        reasons.push('visually-hidden-class');
    }

    return {
        shouldSkip: reasons.length > 0,
        reasons,
    };
}

/** Check if CSS display value belongs to the inline family */
function isInlineDisplay(display: string): boolean {
    const normalized = display.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'contents') return true;
    if (normalized.startsWith('inline')) return true;

    return ['ruby', 'ruby-base', 'ruby-text', 'ruby-base-container', 'ruby-text-container']
        .includes(normalized);
}

/**
 * Detect drop-cap (large initial floating letter).
 * A left-floated element followed by an inline sibling is treated as inline.
 */
function isLargeInitialFloatingLetter(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element);
    return computedStyle.float === 'left'
        && !!element.nextSibling
        && isShallowInlineTransNode(element.nextSibling);
}

/** Check if element is inside an <article> or <main> container */
function isInsideContentContainer(element: HTMLElement): boolean {
    let current: HTMLElement | null = element.parentElement;
    while (current) {
        if (current.tagName === 'ARTICLE' || current.tagName === 'MAIN') return true;
        current = current.parentElement;
    }
    return false;
}

function shouldLogSkipDecision(
    element: HTMLElement,
    decision: SkipDecision,
    range: PageTranslateRange,
): boolean {
    const text = element.textContent?.trim() ?? '';
    if (!text) return false;

    const isLikelyLargeContainer = element.tagName === 'NAV'
        || element.tagName === 'ASIDE'
        || text.length >= 24
        || decision.reasons.includes('main-content-ignore-tag');

    if (!isLikelyLargeContainer) return false;

    const parent = element.parentElement;
    if (!parent) return true;

    const parentDecision = getSkipDecision(parent, range);
    return !parentDecision.shouldSkip;
}

function buildElementPath(element: HTMLElement): string {
    const segments: string[] = [];
    let current: HTMLElement | null = element;

    while (current && segments.length < 5) {
        const id = current.id ? `#${current.id}` : '';
        const className = current.className && typeof current.className === 'string'
            ? `.${current.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
        const testId = current.getAttribute('data-testid');
        const testIdSuffix = testId ? `[data-testid="${testId}"]` : '';
        segments.unshift(`${current.tagName}${id}${className}${testIdSuffix}`);
        current = current.parentElement;
    }

    return segments.join(' > ');
}
