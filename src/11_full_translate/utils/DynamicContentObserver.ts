/**
 * DynamicContentObserver — wraps MutationObserver to detect dynamically added/revealed content.
 * Notifies a callback with new elements that need walking and observation.
 */

import * as loggerModule from '@/0_common/utils/logger';
import { WALKED_ATTRIBUTE, CONTENT_WRAPPER_CLASS, EXTENSION_OWNED_ATTRIBUTE } from '../constants';
import { hasNoWalkAncestor, isDontWalkIntoAndDontTranslateAsChildElement } from '@/11_full_translate/dom/filter';
import type { PageTranslateRange } from '@/11_full_translate/types';

const logger = loggerModule.createLogger('FullTranslate/DynamicContentObserver');

// Mutation observer config
const MUTATION_CONFIG: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
};

// Callback: called with new elements that need walking and observation
export type OnNewContentCallback = (elements: HTMLElement[]) => void;

export class DynamicContentObserver {
    private observer: MutationObserver | null = null;
    private shadowObservers: MutationObserver[] = [];
    private onNewContent: OnNewContentCallback;
    private walkId: string;
    private range: PageTranslateRange;

    constructor(onNewContent: OnNewContentCallback, walkId: string, range: PageTranslateRange) {
        this.onNewContent = onNewContent;
        this.walkId = walkId;
        this.range = range;
    }

    /** Start observing document.body for mutations */
    start(): void {
        if (this.observer) {
            logger.warn('Observer already started');
            return;
        }

        this.observer = new MutationObserver((records) => {
            this.handleMutations(records);
        });

        this.observer.observe(document.body, MUTATION_CONFIG);

        // Discover and observe shadow roots in existing DOM
        this.observeShadowRoots(document.body);

        logger.info('Started observing document.body');
    }

    /** Update walkId when session changes */
    setWalkId(walkId: string): void {
        this.walkId = walkId;
    }

    /** Disconnect and cleanup */
    stop(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.shadowObservers.forEach(o => o.disconnect());
        this.shadowObservers = [];

        logger.info('Stopped');
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    private handleMutations(records: MutationRecord[]): void {
        const newElements: HTMLElement[] = [];

        for (const record of records) {
            if (record.type === 'childList') {
                this.collectAddedElements(record, newElements);
            } else if (record.type === 'attributes') {
                this.collectRevealedElement(record, newElements);
            }
        }

        // Observe shadow roots on newly added elements
        for (const element of newElements) {
            this.observeShadowRoots(element);
        }

        if (newElements.length > 0) {
            this.onNewContent(newElements);
        }
    }

    /** Collect newly added HTMLElement nodes from a childList mutation */
    private collectAddedElements(record: MutationRecord, out: HTMLElement[]): void {
        for (const node of Array.from(record.addedNodes)) {
            if (!isHTMLElementNode(node)) continue;

            const element = node as HTMLElement;
            if (this.shouldSkip(element)) continue;

            out.push(element);
        }
    }

    /** If an attribute mutation reveals a previously hidden element, collect it */
    private collectRevealedElement(record: MutationRecord, out: HTMLElement[]): void {
        const target = record.target;
        if (!isHTMLElementNode(target)) return;

        const element = target as HTMLElement;
        if (this.shouldSkip(element)) return;

        if (didBecomeVisible(element)) {
            out.push(element);
        }
    }

    /** Skip elements that are our wrappers, already walked, or match don't-walk rules */
    private shouldSkip(element: HTMLElement): boolean {
        // Skip extension-owned UI elements
        if (element.hasAttribute(EXTENSION_OWNED_ATTRIBUTE)) return true;
        // Skip TapWord's own injected elements
        if (element.classList.contains(CONTENT_WRAPPER_CLASS)) return true;
        if (element.closest(`.${CONTENT_WRAPPER_CLASS}`)) return true;
        // Skip already-walked elements in current session
        if (element.getAttribute(WALKED_ATTRIBUTE) === this.walkId) return true;
        // Skip elements matching "don't walk" rules (same as initial walk)
        if (isDontWalkIntoAndDontTranslateAsChildElement(element, this.range)) return true;
        // Skip elements inside "don't walk" ancestors
        if (hasNoWalkAncestor(element, this.range)) return true;
        return false;
    }

    /** Recursively discover shadow roots and set up MutationObservers on them */
    private observeShadowRoots(element: HTMLElement): void {
        if (element.shadowRoot) {
            const shadowObserver = new MutationObserver((mutations) => {
                this.handleMutations(mutations);
            });
            shadowObserver.observe(element.shadowRoot, MUTATION_CONFIG);
            this.shadowObservers.push(shadowObserver);
        }

        for (const child of Array.from(element.children)) {
            if (child instanceof HTMLElement) {
                this.observeShadowRoots(child);
            }
        }
    }
}

// ============================================================
// Module-level helpers
// ============================================================

/** Quick HTMLElement type check by nodeType */
function isHTMLElementNode(node: Node): boolean {
    return node.nodeType === Node.ELEMENT_NODE;
}

/** Check if an element is currently visible (not hidden by CSS or attribute) */
function didBecomeVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return style.display !== 'none'
        && style.visibility !== 'hidden'
        && !element.hidden;
}
