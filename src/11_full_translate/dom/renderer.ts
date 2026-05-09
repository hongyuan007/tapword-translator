/**
 * Dual-language renderer for full-page translation.
 * Handles inserting translated text into DOM and cleaning up.
 */

import * as loggerModule from '@/0_common/utils/logger';
import {
    CONTENT_WRAPPER_CLASS,
    INLINE_CONTENT_CLASS,
    BLOCK_CONTENT_CLASS,
    NOTRANSLATE_CLASS,
    BLOCK_ATTRIBUTE,
    INLINE_ATTRIBUTE,
    WALKED_ATTRIBUTE,
    MARK_ATTRIBUTES,
    ATTR_TRANSLATION_MODE,
    ATTR_WALK_ID,
    RTL_LANGUAGE_CODES,
} from '../constants';
import type { FullTranslateMode } from '../types';

/** Metadata stamped on each translation wrapper for identification and cleanup. */
export interface TranslationWrapperMetadata {
    /** Current walk session ID — used to identify stale wrappers. */
    walkId?: string;
    /** Target language code (e.g., "zh-CN", "en") — sets `lang` attribute. */
    targetLang?: string;
}

/** Options for per-unit translation insertion. */
export interface InsertTranslationOptions {
    /** If provided, insert after this node instead of appending to paragraphElement. */
    insertAfterNode?: Node;
    /** Force block-style insertion regardless of element classification. */
    forceBlockTranslation?: boolean;
    /** Text color to apply to the translated span (hex). */
    translationTextColor?: string;
}
import { DomBatcher } from '../utils/DomBatcher';
import { isHTMLElement, isCustomForceBlockTranslation, isForceInlineTranslation, deepQuerySelectorAll } from './filter';

const logger = loggerModule.createLogger('FullTranslate/renderer');

// Spinner CSS class name
const SPINNER_CLASS = 'tapword-translate-spinner';

// Store original content for translationOnly mode restore
const originalContentMap = new WeakMap<Element, string>();

// ============================================================
// Public API
// ============================================================

/**
 * Insert translated text for a paragraph element.
 * Creates a wrapper span around translated text and appends it.
 *
 * For bilingual mode: original text is kept, translation appended
 * For translationOnly mode: original is hidden, translation replaces
 */
export function insertTranslation(
    paragraphElement: HTMLElement,
    translatedText: string,
    mode: FullTranslateMode,
    options?: InsertTranslationOptions,
    metadata?: TranslationWrapperMetadata,
): void {
    // For unit-level insertion, skip duplicate check within local context
    if (!options?.insertAfterNode && hasTranslatedWrapper(paragraphElement)) return;

    // Five-level priority chain (matches read-frog's insertTranslatedNodeIntoWrapper):
    //   1. customForceBlock  → block  (site-specific selector, highest priority)
    //   2. forceInline        → inline (tag whitelist OR self is flex container)
    //   3. forceBlock         → block  (upstream: parent is non-flex mixed paragraph)
    //   4. inline attribute   → inline (walker-labeled inline node)
    //   5. block attribute    → block  (walker-labeled block node)
    const useInline = resolveInsertionMode(paragraphElement, options?.forceBlockTranslation === true);

    const wrapperSpan = document.createElement('span');
    wrapperSpan.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`;

    // Stamp wrapper metadata for identification and cleanup
    wrapperSpan.setAttribute(ATTR_TRANSLATION_MODE, mode);
    if (metadata?.walkId) {
        wrapperSpan.setAttribute(ATTR_WALK_ID, metadata.walkId);
    }
    setTranslationDirAndLang(wrapperSpan, metadata?.targetLang);

    const translatedSpan = document.createElement('span');
    translatedSpan.textContent = translatedText;
    if (options?.translationTextColor) {
        translatedSpan.style.color = options.translationTextColor;
    }

    if (useInline) {
        appendInlineSeparator(wrapperSpan);
        translatedSpan.className = `${NOTRANSLATE_CLASS} ${INLINE_CONTENT_CLASS}`;
    } else {
        appendBlockSeparator(wrapperSpan);
        translatedSpan.className = `${NOTRANSLATE_CLASS} ${BLOCK_CONTENT_CLASS}`;
    }

    wrapperSpan.appendChild(translatedSpan);

    const batcher = DomBatcher.getInstance();

    if (mode === 'translationOnly') {
        batcher.queue(() => applyTranslationOnlyMode(paragraphElement, wrapperSpan));
    } else if (options?.insertAfterNode) {
        // Unit-level: insert after the last node of the inline group
        batcher.queue(() => {
            options.insertAfterNode!.parentNode?.insertBefore(
                wrapperSpan,
                options.insertAfterNode!.nextSibling,
            );
        });
    } else {
        batcher.queue(() => paragraphElement.appendChild(wrapperSpan));
    }
}

/**
 * Remove stale translation wrappers that do NOT belong to the current walk session.
 * Useful after re-walking when dynamic content changes.
 */
export function removeStaleTranslations(currentWalkId: string): void {
    const batcher = DomBatcher.getInstance();
    const wrappers = deepQuerySelectorAll(
        document,
        `.${CONTENT_WRAPPER_CLASS}[${ATTR_WALK_ID}]:not([${ATTR_WALK_ID}="${currentWalkId}"])`,
    );

    wrappers.forEach((wrapper) => {
        if (!isHTMLElement(wrapper)) return;
        const restored = restoreOriginalContent(wrapper);
        if (!restored) {
            batcher.queue(() => wrapper.remove());
        }
    });

    if (wrappers.length > 0) {
        logger.info(`Removed ${wrappers.length} stale translation wrappers`);
    }
}

/**
 * Remove all translated content from the page.
 * Queries for CONTENT_WRAPPER_CLASS elements and removes them,
 * restoring original content for translationOnly mode.
 */
export function removeAllTranslations(): void {
    const batcher = DomBatcher.getInstance();

    // Remove all loading spinners (deep query traverses shadow DOM trees)
    const spinners = deepQuerySelectorAll(document, `.${SPINNER_CLASS}`);
    spinners.forEach((spinner) => {
        batcher.queue(() => spinner.remove());
    });

    // Remove all translation wrappers (deep query traverses shadow DOM trees)
    const wrappers = deepQuerySelectorAll(document, `.${CONTENT_WRAPPER_CLASS}`);
    wrappers.forEach((wrapper) => {
        if (!isHTMLElement(wrapper)) return;

        // Attempt translationOnly restore
        const restored = restoreOriginalContent(wrapper);
        if (!restored) {
            batcher.queue(() => wrapper.remove());
        }
    });

    logger.info(`Removed ${spinners.length} spinners and ${wrappers.length} translation wrappers`);
}

/**
 * Remove walk labels (data attributes) from all elements.
 * Queries for elements with WALKED_ATTRIBUTE and removes all mark attributes.
 */
export function removeWalkLabels(root: HTMLElement = document.documentElement): void {
    const walkedElements = deepQuerySelectorAll(root, `[${WALKED_ATTRIBUTE}]`);
    const batcher = DomBatcher.getInstance();

    batcher.queue(() => {
        walkedElements.forEach((el) => {
            for (const attr of MARK_ATTRIBUTES) {
                el.removeAttribute(attr);
            }
        });
    });

    logger.info(`Removed walk labels from ${walkedElements.length} elements`);
}

/** Create a loading spinner element for a paragraph being translated. */
export function createSpinner(): HTMLSpanElement {
    const spinner = document.createElement('span');
    spinner.className = SPINNER_CLASS;
    applySpinnerStyles(spinner);
    animateSpinner(spinner);
    return spinner;
}

/** Remove spinner from a paragraph element. */
export function removeSpinner(paragraphElement: HTMLElement): void {
    const spinner = paragraphElement.querySelector(`:scope > .${SPINNER_CLASS}`);
    if (spinner) {
        DomBatcher.getInstance().queue(() => spinner.remove());
    }
}

/** Remove all spinner elements from the page. */
export function removeAllSpinners(): void {
    const spinners = document.querySelectorAll(`.${SPINNER_CLASS}`);
    const batcher = DomBatcher.getInstance();

    spinners.forEach((spinner) => {
        batcher.queue(() => spinner.remove());
    });
}

// ============================================================
// Internal Helpers
// ============================================================

/** Check if paragraph already has a translated wrapper */
function hasTranslatedWrapper(element: HTMLElement): boolean {
    return element.querySelector(`.${CONTENT_WRAPPER_CLASS}`) !== null;
}

/**
 * Five-level priority chain determining inline vs. block insertion.
 * Matches read-frog's insertTranslatedNodeIntoWrapper priority order:
 *   1. customForceBlock  → block  (highest — site-specific selectors)
 *   2. forceInline        → inline (tag whitelist OR self is flex)
 *   3. forceBlock         → block  (upstream flag from walker)
 *   4. inline attribute   → inline (walker-labeled)
 *   5. block attribute    → block  (walker-labeled)
 *   fallback             → inline if computed display is inline-family
 */
function resolveInsertionMode(element: HTMLElement, forceBlockFromUpstream: boolean): boolean {
    // Priority 1: site-specific force block (highest)
    if (isCustomForceBlockTranslation(element)) return false;

    // Priority 2: force inline (tag whitelist OR flex container)
    if (isForceInlineTranslation(element)) return true;

    // Priority 3: upstream force block (from walker/translationWalker)
    if (forceBlockFromUpstream) return false;

    // Priority 4: walker-labeled inline
    if (element.hasAttribute(INLINE_ATTRIBUTE)) return true;

    // Priority 5: walker-labeled block
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) return false;

    // Fallback: computed display for unlabeled elements
    const display = window.getComputedStyle(element).display;
    return display.startsWith('inline');
}

/** Append inline separator (double space) into wrapper */
function appendInlineSeparator(wrapper: HTMLElement): void {
    const spaceNode = document.createElement('span');
    spaceNode.textContent = '  ';
    wrapper.appendChild(spaceNode);
}

/** Append block separator (<br>) into wrapper */
function appendBlockSeparator(wrapper: HTMLElement): void {
    const br = document.createElement('br');
    wrapper.appendChild(br);
}

/** Save original content, then replace with translation wrapper */
function applyTranslationOnlyMode(paragraphElement: HTMLElement, wrapperSpan: HTMLElement): void {
    if (!originalContentMap.has(paragraphElement)) {
        originalContentMap.set(paragraphElement, paragraphElement.innerHTML);
    }
    paragraphElement.innerHTML = '';
    paragraphElement.appendChild(wrapperSpan);
}

/** Attempt to restore original content for a translationOnly wrapper. Returns true if restored. */
function restoreOriginalContent(wrapper: HTMLElement): boolean {
    let current: Node | null = wrapper.parentNode;
    while (current && isHTMLElement(current)) {
        const original = originalContentMap.get(current);
        if (original !== undefined) {
            const nodeToRestore = current;
            DomBatcher.getInstance().queue(() => {
                nodeToRestore.innerHTML = original;
            });
            originalContentMap.delete(current);
            return true;
        }
        current = current.parentNode;
    }
    return false;
}

/** Apply inline CSS styles to the spinner element */
function applySpinnerStyles(spinner: HTMLSpanElement): void {
    const SPINNER_SIZE = '12px';
    const SPINNER_BORDER_WIDTH = '2px';

    spinner.style.display = 'inline-block';
    spinner.style.width = SPINNER_SIZE;
    spinner.style.height = SPINNER_SIZE;
    spinner.style.border = `${SPINNER_BORDER_WIDTH} solid rgba(0, 0, 0, 0.15)`;
    spinner.style.borderTopColor = 'rgba(0, 0, 0, 0.5)';
    spinner.style.borderRadius = '50%';
    spinner.style.verticalAlign = 'middle';
    spinner.style.marginLeft = '4px';
}

/** Animate spinner rotation via Web Animations API */
function animateSpinner(spinner: HTMLSpanElement): void {
    spinner.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: 800, iterations: Infinity, easing: 'linear' },
    );
}

/**
 * Set `dir` and `lang` attributes on a translation wrapper element.
 * Determines text direction from target language code.
 */
function setTranslationDirAndLang(element: HTMLElement, targetLang?: string): void {
    if (!targetLang) return;
    const dir = RTL_LANGUAGE_CODES.has(targetLang) ? 'rtl' : 'ltr';
    element.setAttribute('dir', dir);
    element.setAttribute('lang', targetLang);
}
