/**
 * DOM helper utilities for full-page translation.
 * Provides element unwrapping and truncation-style removal.
 */

import type { PageTranslateRange } from '../types';
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

        const shouldKeepNode = (child: ChildNode): boolean => {
            if (!child.textContent?.trim()) return false;
            if (child.nodeType === Node.TEXT_NODE) return true;
            return isHTMLElement(child)
                && !isDontWalkIntoAndDontTranslateAsChildElement(child, range);
        };

        const effectiveChildNodes = Array.from(currentElement.childNodes).filter(shouldKeepNode);
        const effectiveChildren = effectiveChildNodes.filter(
            child => child.nodeType === Node.ELEMENT_NODE,
        );

        // Only unwrap when there is exactly one HTML child and no text siblings
        if (!(effectiveChildren.length === 1 && effectiveChildNodes.length === 1)) break;

        const onlyChildElement = effectiveChildren[0];
        if (!onlyChildElement || !isHTMLElement(onlyChildElement)) break;

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
