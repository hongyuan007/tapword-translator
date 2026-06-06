/**
 * DOM utilities for full-page translation.
 * Provides DOM walking, labeling, and element classification.
 */

// --- Filter Functions ---
export {
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
} from './filter';

// --- Walker Functions ---
export {
    walkAndLabelElement,
    extractTextContent,
} from './walker';

// --- Renderer Functions ---
export {
    insertTranslation,
    removeAllTranslations,
    removeStaleTranslations,
    removeAllSpinners,
    removeWalkLabels,
    createSpinner,
    removeSpinner,
} from './renderer';
export type { InsertTranslationOptions, TranslationWrapperMetadata } from './renderer';

// --- Translation Walker Functions ---
export type { TranslationUnit } from './translationWalker';
export {
    extractTranslationUnits,
    extractParagraphText,
    shouldTranslateParagraph,
    collectBlockChildren,
} from './translationWalker';

// --- DOM Helper Functions ---
export {
    unwrapDeepestOnlyHTMLChild,
    smashTruncationStyle,
} from './helpers';
