/**
 * 11_full_translate: Full-page translation module
 *
 * Provides types, constants, and utilities for translating entire web pages.
 */

// --- Types ---
export type {
    TransNode,
    FullTranslateMode,
    PageTranslateRange,
    FullTranslateConfig,
    PreloadConfig,
    WalkResult,
    ParagraphInfo,
    ParagraphTranslationStatus,
    BatchTranslationItem,
    BatchTranslationResult,
} from './types';

// --- Constants ---
export {
    // Data attributes
    WALKED_ATTRIBUTE,
    PARAGRAPH_ATTRIBUTE,
    BLOCK_ATTRIBUTE,
    INLINE_ATTRIBUTE,
    MARK_ATTRIBUTES,
    ATTR_TRANSLATION_MODE,
    ATTR_WALK_ID,
    // CSS classes
    CONTENT_WRAPPER_CLASS,
    INLINE_CONTENT_CLASS,
    BLOCK_CONTENT_CLASS,
    NOTRANSLATE_CLASS,
    // Tag classification
    DONT_WALK_AND_TRANSLATE_TAGS,
    DONT_WALK_BUT_TRANSLATE_TAGS,
    FORCE_BLOCK_TAGS,
    FORCE_INLINE_TRANSLATION_TAGS,
    MAIN_CONTENT_IGNORE_TAGS,
    // Site-specific selectors
    CUSTOM_FORCE_BLOCK_SELECTORS,
    CUSTOM_DONT_WALK_SELECTORS,
    // Batch queue defaults
    BATCH_SEPARATOR,
    DEFAULT_BATCH_DELAY_MS,
    DEFAULT_MAX_CHARS_PER_BATCH,
    DEFAULT_MAX_ITEMS_PER_BATCH,
    // Rate limiter defaults
    DEFAULT_REQUEST_RATE,
    DEFAULT_REQUEST_CAPACITY,
    // Preload defaults
    DEFAULT_PRELOAD_MARGIN,
    DEFAULT_PRELOAD_THRESHOLD,
    // Text filter defaults
    DEFAULT_MIN_CHARS_PER_NODE,
    DEFAULT_MIN_WORDS_PER_NODE,
    // RTL languages
    RTL_LANGUAGE_CODES,
} from './constants';

// --- DOM ---
export {
    // Filter functions
    isHTMLElement,
    isTextNode,
    isTransNode,
    isShallowInlineTransNode,
    isShallowInlineHTMLElement,
    isShallowBlockHTMLElement,
    isDontWalkIntoButTranslateAsChildElement,
    isDontWalkIntoAndDontTranslateAsChildElement,
    isCustomForceBlockTranslation,
    isCustomDontWalkIntoElement,
    isForceInlineTranslation,
    isTranslatedWrapperNode,
    isNumericContent,
    hasNoWalkAncestor,
    deepQuerySelectorAll,
    // Walker functions
    walkAndLabelElement,
    extractTextContent,
    // Renderer functions
    insertTranslation,
    removeAllTranslations,
    removeStaleTranslations,
    removeAllSpinners,
    removeWalkLabels,
    createSpinner,
    removeSpinner,
    // Translation walker functions
    extractTranslationUnits,
    extractParagraphText,
    shouldTranslateParagraph,
    // DOM helper functions
    unwrapDeepestOnlyHTMLChild,
    smashTruncationStyle,
} from './dom';
export type { TranslationUnit } from './dom';

// --- Utils ---
export { ViewportObserver } from './utils/ViewportObserver';
export type { OnEnterViewportCallback } from './utils/ViewportObserver';
export { DynamicContentObserver } from './utils/DynamicContentObserver';
export type { OnNewContentCallback } from './utils/DynamicContentObserver';
export { DomBatcher } from './utils/DomBatcher';
export { BatchQueue } from './utils/BatchQueue';
export { TokenBucketRateLimiter } from './utils/TokenBucketRateLimiter';
export { TranslationCache } from './utils/TranslationCache';

// --- Manager ---
export { PageTranslationManager } from './PageTranslationManager';
