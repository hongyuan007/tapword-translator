/**
 * DOM helper utilities for full-page translation.
 * Provides element unwrapping and truncation-style removal.
 */

import type { PageTranslateRange } from '../types';
import { BLOCK_ATTRIBUTE, INLINE_ATTRIBUTE } from '../constants';
import { isHTMLElement, isDontWalkIntoAndDontTranslateAsChildElement } from './filter';

// ============================================================
// Public API
// ============================================================

/**
 * Traverses down through elements that have exactly one meaningful HTML child,
 * ignoring whitespace-only text nodes and "don't translate" elements.
 * Returns the deepest such element. If the element has multiple meaningful
 * children or non-whitespace text siblings, returns itself.
 *
 * Also calls smashTruncationStyle on each level during traversal, so that
 * wrapper elements don't clip the translated content.
 */
export function unwrapDeepestOnlyHTMLChild(
    element: HTMLElement,
    range: PageTranslateRange,
): HTMLElement {
    let currentElement = element;
    while (currentElement) {
        smashTruncationStyle(currentElement);

        const effectiveChildNodes = getMeaningfulChildNodes(currentElement, range);
        const effectiveChildren = effectiveChildNodes.filter(
            child => child.nodeType === Node.ELEMENT_NODE,
        );

        // Only unwrap when there is exactly one HTML child and no text siblings
        if (!(effectiveChildren.length === 1 && effectiveChildNodes.length === 1)) break;

        const onlyChildElement = effectiveChildren[0];
        if (!onlyChildElement || !isHTMLElement(onlyChildElement)) break;

        // Stop at the first block-like node that directly owns text content,
        // or that immediately wraps a single inline text leaf.
        // This preserves content containers such as tweetText divs while still
        // allowing pure wrapper chains like div > div > div > text to unwrap.
        if (shouldKeepCurrentElementAsInsertionTarget(currentElement, onlyChildElement)) {
            break;
        }

        currentElement = onlyChildElement;
    }

    return currentElement;
}

/**
 * Removes CSS properties that would clip or truncate translated text.
 * Schedules the style mutations via requestIdleCallback (with fallbacks)
 * to avoid blocking the main thread.
 */
export function smashTruncationStyle(element: HTMLElement): void {
    if (typeof window === 'undefined') return;

    const scheduleIdleTask = (callback: () => void): void => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(callback);
        } else if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(callback);
        } else {
            setTimeout(callback, 0);
        }
    };

    scheduleIdleTask(() => {
        const computedStyle = window.getComputedStyle(element);

        if (computedStyle.webkitLineClamp && computedStyle.webkitLineClamp !== 'none') {
            element.style.webkitLineClamp = 'unset';
        }

        if (computedStyle.maxHeight && computedStyle.maxHeight !== 'none') {
            element.style.maxHeight = 'unset';
        }

        if (computedStyle.textOverflow === 'ellipsis') {
            element.style.textOverflow = 'unset';
        }
    });
}

function getMeaningfulChildNodes(
    element: HTMLElement,
    range: PageTranslateRange,
): ChildNode[] {
    return Array.from(element.childNodes).filter((child: ChildNode): boolean => {
        if (!child.textContent?.trim()) return false;
        if (child.nodeType === Node.TEXT_NODE) return true;
        return isHTMLElement(child)
            && !isDontWalkIntoAndDontTranslateAsChildElement(child, range);
    });
}

function shouldKeepCurrentElementAsInsertionTarget(
    currentElement: HTMLElement,
    onlyChildElement: HTMLElement,
): boolean {
    if (hasMeaningfulDirectText(currentElement)) {
        return true;
    }

    const currentIsBlockLike = isBlockLikeNode(currentElement);
    const childIsInlineLike = isInlineLikeNode(onlyChildElement);
    if (currentIsBlockLike && childIsInlineLike) {
        return true;
    }

    return false;
}

function hasMeaningfulDirectText(element: HTMLElement): boolean {
    return Array.from(element.childNodes).some((child: ChildNode): boolean => (
        child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim()
    ));
}

function isBlockLikeNode(element: HTMLElement): boolean {
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) {
        return true;
    }

    if (element.hasAttribute(INLINE_ATTRIBUTE)) {
        return false;
    }

    const display = window.getComputedStyle(element).display;
    return !display.startsWith('inline') && display !== 'contents';
}

function isInlineLikeNode(element: HTMLElement): boolean {
    if (element.hasAttribute(INLINE_ATTRIBUTE)) {
        return true;
    }

    if (element.hasAttribute(BLOCK_ATTRIBUTE)) {
        return false;
    }

    const display = window.getComputedStyle(element).display;
    return display.startsWith('inline') || display === 'contents';
}
