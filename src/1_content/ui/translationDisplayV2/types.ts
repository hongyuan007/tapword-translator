/**
 * @file types.ts
 * Shared type definitions and named constants for the translationDisplayV2 module.
 * V2 variant replaces DOM-wrapping anchor approach with Range-based, zero-DOM-intrusion architecture.
 * This file has no runtime dependencies and is safe to import from any layer.
 */

import type { TranslationDetailData } from "@/1_content/ui/translationModal"

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Translation display state while the AI request is in-flight. */
export interface LoadingState {
    status: "loading"
    text: string
    /** "spinner" renders an animated spinner icon; default "text" renders the raw text. */
    loadingVariant?: "text" | "spinner"
}

/** Translation display state after a successful AI response. */
export interface SuccessState {
    status: "success"
    translation: string
    sentenceTranslation?: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    targetLanguage?: string
    /** Canonical base form of the word (e.g. "run" for "running"). */
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
}

/** Translation display state when the AI request fails. */
export interface ErrorState {
    status: "error"
    text: string
    errorMessage?: string
}

/** Discriminated union covering every possible display state. */
export type TranslationState = LoadingState | SuccessState | ErrorState

/** Subset of user settings consumed directly by the display layer. */
export type DisplayUserSettings = {
    translationFontSizePreset?: import("@/0_common/types").TranslationFontSizePreset
    autoAdjustHeight?: boolean
}

/**
 * A single tracked translation annotation.
 * Replaces V1's multiple separate Maps with one unified entry.
 */
export interface TranslationEntry {
    /** Unique identifier for this translation (e.g. "translation-0"). */
    id: string
    /** Live Range referencing the original text nodes — never mutates the DOM. */
    range: Range
    /** Tooltip segment elements appended to document.body (one per visual line). */
    tooltips: HTMLElement[]
    /** Full translation detail data fed into the detail modal on click. */
    translationData: TranslationDetailData
    /** The raw selected string. */
    originalText: string
    /** Whether this is a word or fragment translation. */
    translationType: "word" | "fragment"
    /** Date.now() at creation — used for interaction grace period. */
    creationTime: number
}

// ============================================================================
// Constants
// ============================================================================

/** Debounce window (ms) that separates a single-click from a double-click. */
export const CLICK_DEBOUNCE_DELAY_MS = 200

/**
 * Grace period (ms) after translation creation during which click/dblclick events are ignored.
 * Prevents accidental modal open/close when the translation is created by a single-click translate.
 */
export const INTERACTION_GRACE_PERIOD_MS = 400

/**
 * Max pixel tolerance when grouping DOMRects that belong to the same visual line.
 * Handles sub-pixel rounding differences across browsers.
 */
export const LINE_GROUP_EPSILON_PX = 2

/** Minimum padding (px) between a tooltip edge and the viewport boundary. */
export const VIEWPORT_PAD_PX = 8

/**
 * Rounding granularity (px) for the rect signature string.
 * Coarser rounding reduces unnecessary re-splits on sub-pixel scroll jitter.
 */
export const RECT_SIGNATURE_ROUND_PX = 1

/**
 * Horizontal padding (px) added to Range bounding rects during hit testing.
 * Covers the whitespace gap between words so that clicking near a translated
 * word (e.g. the space between "by" and "American") still registers as a hit.
 */
export const RANGE_HIT_TEST_HORIZONTAL_PAD_PX = 4
