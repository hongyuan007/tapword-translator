/**
 * Full-page translation type definitions
 */

// A DOM node that can participate in translation
export type TransNode = HTMLElement | Text;

// Translation display mode
export type FullTranslateMode = "bilingual" | "translationOnly";

// Page translation range
export type PageTranslateRange = "main" | "all";

// Configuration for full-page translation
export interface FullTranslateConfig {
    mode: FullTranslateMode;
    range: PageTranslateRange;
    preload: PreloadConfig;
    minCharactersPerNode: number;
    minWordsPerNode: number;
    sourceLang: string;
    targetLang: string;
}

// IntersectionObserver preload settings
export interface PreloadConfig {
    /** rootMargin in px */
    margin: number;
    /** Intersection ratio threshold */
    threshold: number;
}

// Result of walking a single element
export interface WalkResult {
    forceBlock: boolean;
    isInlineNode: boolean;
}

// A paragraph ready for translation
export interface ParagraphInfo {
    /** The paragraph container element */
    element: HTMLElement;
    /** Extracted text content */
    textContent: string;
    /** Session ID */
    walkId: string;
}

// Translation state for a single paragraph
export type ParagraphTranslationStatus = "pending" | "translating" | "translated" | "error";

/** A group of consecutive inline nodes forming a single translation unit. */
export interface TranslationUnit {
    /** The consecutive inline nodes that form this unit. */
    nodes: Node[];
    /** Extracted text content for translation. */
    text: string;
    /** If true, insert translation as block element (for units sibling to block children). */
    forceBlockTranslation: boolean;
}

// Batch translation request item
export interface BatchTranslationItem {
    /** Unique ID for correlating response */
    id: string;
    /** Text to translate */
    text: string;
    sourceLang: string;
    targetLang: string;
}

// Batch translation result item
export interface BatchTranslationResult {
    id: string;
    translatedText: string;
    error?: string;
}
