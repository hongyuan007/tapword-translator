/**
 * PageTranslationManager — top-level orchestrator for full-page translation.
 * Coordinates DOM walking, viewport observation, dynamic content detection,
 * batched translation, caching, and rendering.
 */

import * as loggerModule from '@/0_common/utils/logger';
import type { FullTranslateFallbackInfo } from '@/0_common/types';
import type { FullTranslateConfig, TranslationUnit } from './types';
import { PARAGRAPH_ATTRIBUTE, WALKED_ATTRIBUTE } from './constants';
import {
    walkAndLabelElement,
    extractTranslationUnits,
    extractParagraphText,
    shouldTranslateParagraph,
    collectBlockChildren,
    insertTranslation,
    removeAllTranslations,
    removeWalkLabels,
    createSpinner,
    removeSpinner,
    isHTMLElement,
    deepQuerySelectorAll,
    unwrapDeepestOnlyHTMLChild,
    smashTruncationStyle,
} from './dom';
import { ViewportObserver } from './utils/ViewportObserver';
import { DynamicContentObserver } from './utils/DynamicContentObserver';
import { BatchQueue } from './utils/BatchQueue';
import { TokenBucketRateLimiter } from './utils/TokenBucketRateLimiter';
import { TranslationCache } from './utils/TranslationCache';
import type { TranslationWrapperMetadata } from './dom';

const logger = loggerModule.createLogger('FullTranslate/PageTranslationManager');

// ============================================================
// Public API
// ============================================================

const PROGRESS_LOG_INTERVAL = 20;
const WHITESPACE_SEQUENCE_PATTERN = /\s+/g;

export class PageTranslationManager {

    // --- State ---
    private walkId: string | null = null;
    private isRunning: boolean = false;
    private config: FullTranslateConfig;

    // --- Aggregate stats ---
    private stats = { paragraphsProcessed: 0, unitsTranslated: 0, cacheHits: 0, passthroughSkipped: 0, errors: 0, startTime: 0 };

    // --- Components ---
    private viewportObserver: ViewportObserver | null = null;
    private dynamicContentObserver: DynamicContentObserver | null = null;
    private batchQueue: BatchQueue | null = null;
    private cache: TranslationCache;
    private rateLimiter: TokenBucketRateLimiter;

    // --- Duplicate prevention ---
    private translatingNodes: WeakSet<Element> = new WeakSet();

    /** Callback invoked when a batch response indicates quota exhaustion */
    onQuotaExhausted?: () => void;
    /** Callback invoked when a batch response indicates runtime provider fallback */
    onProviderFallback?: (fallbackInfo: FullTranslateFallbackInfo) => void;

    constructor(config: FullTranslateConfig) {
        this.config = config;
        this.cache = new TranslationCache();
        this.rateLimiter = new TokenBucketRateLimiter();
    }

    /**
     * Start full-page translation.
     * Walks the DOM, sets up viewport and mutation observers,
     * and begins translating visible paragraphs.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            this.stop();
        }

        this.isRunning = true;
        this.walkId = this.generateWalkId();
        this.stats = { paragraphsProcessed: 0, unitsTranslated: 0, cacheHits: 0, passthroughSkipped: 0, errors: 0, startTime: Date.now() };

        this.batchQueue = new BatchQueue({
            sourceLang: this.config.sourceLang,
            targetLang: this.config.targetLang,
        });
        this.batchQueue.onQuotaExhausted = () => this.onQuotaExhausted?.();
        this.batchQueue.onProviderFallback = (fallbackInfo) => this.onProviderFallback?.(fallbackInfo);

        this.viewportObserver = new ViewportObserver(
            (element) => this.onParagraphVisible(element),
            this.config.preload.margin,
            this.config.preload.threshold,
        );
        this.viewportObserver.start();

        // Walk and label the entire document body
        walkAndLabelElement(document.body, this.walkId, this.config.range);

        // Collect and observe only top-level paragraph elements
        const allParagraphs = this.collectParagraphs(document.body);
        const paragraphs = this.filterTopLevelParagraphs(allParagraphs);
        for (const paragraph of paragraphs) {
            this.viewportObserver.observe(paragraph);
        }

        // Start observing dynamic content mutations
        this.dynamicContentObserver = new DynamicContentObserver(
            (elements) => this.onNewContentDetected(elements),
            this.walkId,
            this.config.range,
        );
        this.dynamicContentObserver.start();

        logger.info('Started full-page translation', {
            walkId: this.walkId,
            hostname: window.location.hostname,
            mode: this.config.mode,
            range: this.config.range,
            paragraphCount: paragraphs.length,
        });
    }

    /**
     * Stop full-page translation and clean up all resources.
     */
    stop(): void {
        this.isRunning = false;
        this.walkId = null;

        this.viewportObserver?.stop();
        this.viewportObserver = null;

        this.dynamicContentObserver?.stop();
        this.dynamicContentObserver = null;

        this.batchQueue?.clear();
        this.batchQueue = null;

        removeAllTranslations();
        removeWalkLabels();

        this.translatingNodes = new WeakSet();

        logger.info('Stopped full-page translation');
    }

    /**
     * Pause translation without removing existing translations from the DOM.
     * Used when quota is exhausted to preserve already-translated content.
     */
    pause(): void {
        this.isRunning = false;
        this.walkId = null;

        this.viewportObserver?.stop();
        this.viewportObserver = null;

        this.dynamicContentObserver?.stop();
        this.dynamicContentObserver = null;

        this.batchQueue?.clear();
        this.batchQueue = null;

        this.translatingNodes = new WeakSet();

        logger.info('Paused full-page translation (existing translations preserved)');
    }

    /** Check if the manager is currently running. */
    getIsRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Update configuration (e.g., language change).
     * Stops and restarts if currently running.
     */
    async updateConfig(config: Partial<FullTranslateConfig>): Promise<void> {
        this.config = { ...this.config, ...config };

        if (this.isRunning) {
            this.stop();
            await this.start();
        }
    }

    // ============================================================
    // Private Methods
    // ============================================================

    /** Generate a unique walk session ID. */
    private generateWalkId(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        // Fallback for environments without crypto.randomUUID
        return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    }

    /** Build metadata passed to each translation wrapper. */
    private buildWrapperMetadata(): TranslationWrapperMetadata {
        return {
            walkId: this.walkId ?? undefined,
            targetLang: this.config.targetLang,
        };
    }

    /** Called when a paragraph element enters the viewport. Delegates to recursive translateElement. */
    private async onParagraphVisible(element: HTMLElement): Promise<void> {
        logger.debug('[onParagraphVisible]', {
            tag: element.tagName,
            text: element.textContent?.substring(0, 50),
        });
        await this.translateElement(element);
    }

    /**
     * Recursively translate a paragraph element.
     * Simple case (no block children): translates as a single unit.
     * Complex case (mixed block + inline): translates each inline group separately
     * and recursively processes block children.
     * Non-paragraph elements: recurses into child elements.
     */
    private async translateElement(element: HTMLElement): Promise<void> {
        // Guard: already processing or session changed
        if (this.translatingNodes.has(element)) return;
        if (!this.isRunning || !this.batchQueue || !this.walkId) return;
        if (element.getAttribute(WALKED_ATTRIBUTE) !== this.walkId) return;

        const elementInfo = { tag: element.tagName, text: element.textContent?.substring(0, 50) };

        // Non-paragraph: recurse into children
        if (!element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
            logger.debug('[translateElement] non-paragraph, recursing into children', elementInfo);
            const promises: Promise<void>[] = [];
            for (const child of Array.from(element.childNodes)) {
                if (isHTMLElement(child)) {
                    promises.push(this.translateElement(child));
                }
            }
            await Promise.all(promises);
            return;
        }

        // --- Paragraph element ---
        this.translatingNodes.add(element);

        const blockChildren = collectBlockChildren(element);
        const hasBlockChildren = blockChildren.length > 0;

        // translationOnly mode with mixed content falls back to simple case (Appendix A)
        if (!hasBlockChildren || this.config.mode === 'translationOnly') {
            logger.debug('[translateElement] simple paragraph branch', elementInfo);
            await this.translateSimpleParagraph(element);
        } else {
            logger.debug('[translateElement] mixed paragraph branch', { ...elementInfo, blockChildrenCount: blockChildren.length });
            await this.translateMixedParagraph(element, blockChildren);
        }
    }

    /** Simple case: translate the entire paragraph as one unit. */
    private async translateSimpleParagraph(element: HTMLElement): Promise<void> {
        // Unwrap redundant wrapper divs to reach the actual content node,
        // also smashing truncation styles (ellipsis, line-clamp) along the way.
        const targetElement = unwrapDeepestOnlyHTMLChild(element, this.config.range);
        const text = extractParagraphText(targetElement, this.config.range);

        if (!shouldTranslateParagraph(text, this.config.minCharactersPerNode, this.config.minWordsPerNode, this.config.targetLang)) {
            logger.debug('[translateSimpleParagraph] skipped — did not pass shouldTranslateParagraph');
            this.stats.paragraphsProcessed++;
            this.logProgress();
            return;
        }

        const spinner = createSpinner();
        targetElement.appendChild(spinner);

        try {
            const translated = await this.translateText(text);
            if (!this.canApplyTranslation(element)) {
                removeSpinner(targetElement);
                return;
            }
            removeSpinner(targetElement);
            if (translated && this.shouldRenderTranslation(text, translated)) {
                insertTranslation(targetElement, translated, this.config.mode, { translationTextColor: this.config.translationTextColor }, this.buildWrapperMetadata());
            } else if (!translated) {
                logger.warn('[translateSimpleParagraph] translateText returned null', { text: text.substring(0, 50) });
            }
        } catch (error) {
            logger.error('[translateSimpleParagraph] failed', error);
            removeSpinner(targetElement);
        }

        this.stats.paragraphsProcessed++;
        this.logProgress();
    }

    /** Complex case: translate inline groups separately and recurse into block children. */
    private async translateMixedParagraph(
        element: HTMLElement,
        blockChildren: HTMLElement[],
    ): Promise<void> {
        // Remove truncation styles so full translated text is visible
        smashTruncationStyle(element);

        // Single spinner for the mixed paragraph (Appendix B)
        const spinner = createSpinner();
        element.appendChild(spinner);

        const units = extractTranslationUnits(element, this.config.range);
        logger.debug('[translateMixedParagraph] start', {
            tag: element.tagName,
            inlineUnits: units.length,
            blockChildren: blockChildren.length,
        });
        const promises: Promise<void>[] = [];

        // Translate each inline group
        for (const unit of units) {
            if (!shouldTranslateParagraph(unit.text, this.config.minCharactersPerNode, this.config.minWordsPerNode, this.config.targetLang)) {
                continue;
            }
            promises.push(this.translateUnit(element, unit));
        }

        // Recursively translate block children
        for (const blockChild of blockChildren) {
            promises.push(this.translateElement(blockChild));
        }

        try {
            await Promise.all(promises);
        } finally {
            removeSpinner(element);
        }
    }

    /** Translate a single TranslationUnit (inline group) and insert at the correct DOM position. */
    private async translateUnit(
        paragraphElement: HTMLElement,
        unit: TranslationUnit,
    ): Promise<void> {
        const lastNode = unit.nodes[unit.nodes.length - 1];

        try {
            const translated = await this.translateText(unit.text);
            if (!this.canApplyTranslation(paragraphElement)) return;
            if (translated && this.shouldRenderTranslation(unit.text, translated)) {
                this.stats.unitsTranslated++;
                insertTranslation(paragraphElement, translated, this.config.mode, {
                    insertAfterNode: lastNode,
                    forceBlockTranslation: unit.forceBlockTranslation,
                    translationTextColor: this.config.translationTextColor,
                }, this.buildWrapperMetadata());
            } else if (!translated) {
                logger.warn('[translateUnit] translateText returned null', { text: unit.text.substring(0, 50) });
            }
        } catch (error) {
            logger.error('[translateUnit] failed', error);
        }
    }

    /** Core translation logic: check cache, rate-limit, enqueue. */
    private async translateText(text: string): Promise<string | null> {
        const snippet = text.substring(0, 50);
        try {
            // Check cache first
            const cached = await this.cache.get(text, this.config.sourceLang, this.config.targetLang);
            if (cached) {
                logger.debug('[translateText] cache hit', { text: snippet });
                this.stats.cacheHits++;
                return cached;
            }

            // Rate limit then enqueue
            await this.rateLimiter.acquire();

            // Guard: session may have changed while waiting
            if (!this.isRunning || !this.batchQueue) {
                logger.warn('[translateText] session ended while waiting', { text: snippet });
                return null;
            }

            const translated = await this.batchQueue.enqueue(text);

            // Guard: session may have been stopped while batch was in flight
            if (!this.isRunning) return null;

            // Cache the result
            await this.cache.set(text, this.config.sourceLang, this.config.targetLang, translated);

            return translated;
        } catch (error) {
            this.stats.errors++;
            logger.error('[translateText] enqueue error', { text: snippet, error });
            return null;
        }
    }

    /**
     * Called when DynamicContentObserver detects new content.
     * Walks new elements and observes resulting paragraphs.
     */
    private onNewContentDetected(elements: HTMLElement[]): void {
        if (!this.walkId || !this.viewportObserver) return;

        for (const element of elements) {
            this.walkAndObserve(element);
        }
    }

    /** Walk an element and observe its top-level paragraphs with the viewport observer. */
    private walkAndObserve(element: HTMLElement): void {
        if (!this.walkId || !this.viewportObserver) return;

        walkAndLabelElement(element, this.walkId, this.config.range);

        const allParagraphs = this.collectParagraphs(element);
        const paragraphs = this.filterTopLevelParagraphs(allParagraphs);
        logger.debug('[walkAndObserve]', {
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 80),
            collectedParagraphs: allParagraphs.length,
            topLevelParagraphs: paragraphs.length,
        });
        for (const paragraph of paragraphs) {
            this.viewportObserver.observe(paragraph);
        }
    }

    /** Collect all paragraph elements under root that belong to the current walk session. */
    private collectParagraphs(root: HTMLElement): HTMLElement[] {
        const selector = `[${PARAGRAPH_ATTRIBUTE}][${WALKED_ATTRIBUTE}="${CSS.escape(this.walkId!)}"]`;
        // Deep query traverses shadow DOM trees for paragraph collection
        const descendants = deepQuerySelectorAll(root, selector);
        // deepQuerySelectorAll only searches descendants; check if root itself matches
        if (root.matches(selector)) {
            descendants.unshift(root);
        }
        return descendants;
    }

    /** Log aggregate progress every N paragraphs. */
    private logProgress(): void {
        if (this.stats.paragraphsProcessed % PROGRESS_LOG_INTERVAL === 0) {
            const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
            logger.info('[progress]', {
                paragraphs: this.stats.paragraphsProcessed,
                units: this.stats.unitsTranslated,
                cacheHits: this.stats.cacheHits,
                passthroughSkipped: this.stats.passthroughSkipped,
                errors: this.stats.errors,
                elapsed: `${elapsed}s`,
            });
        }
    }

    private shouldRenderTranslation(sourceText: string, translatedText: string): boolean {
        if (this.normalizeForDisplayCompare(sourceText) !== this.normalizeForDisplayCompare(translatedText)) {
            return true;
        }

        this.stats.passthroughSkipped++;
        logger.debug('[shouldRenderTranslation] skipped unchanged translation', {
            text: sourceText.substring(0, 50),
        });
        return false;
    }

    private normalizeForDisplayCompare(text: string): string {
        return text.trim().replace(WHITESPACE_SEQUENCE_PATTERN, ' ');
    }

    /**
     * Filter paragraphs to only keep top-level ones.
     * Removes paragraphs that are nested inside other paragraph elements from the same walk session.
     */
    private filterTopLevelParagraphs(paragraphs: HTMLElement[]): HTMLElement[] {
        return paragraphs.filter(p => {
            let ancestor = p.parentElement;
            while (ancestor && ancestor !== document.body) {
                if (ancestor.hasAttribute(PARAGRAPH_ATTRIBUTE)
                    && ancestor.getAttribute(WALKED_ATTRIBUTE) === this.walkId) {
                    return false;
                }
                ancestor = ancestor.parentElement;
            }
            return true;
        });
    }

    private canApplyTranslation(element: HTMLElement): boolean {
        return this.isRunning
            && this.walkId !== null
            && element.getAttribute(WALKED_ATTRIBUTE) === this.walkId;
    }
}
