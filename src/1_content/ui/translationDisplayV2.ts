/**
 * @file translationDisplayV2.ts
 * Coordinator for the V2 translation display subsystem.
 *
 * Uses a Range-based, zero-DOM-intrusion architecture: selected text is never
 * wrapped in an anchor `<span>`. Instead, a live `Range` object tracks the original
 * text nodes while tooltips are portalled to `document.body`.
 *
 * Key differences from V1 (`translationDisplay.ts`):
 *   - No `extractContents()` / `insertNode()` / anchor `<span>` creation
 *   - No `unwrapAnchorElement()` / `parent.normalize()` on cleanup
 *   - No `IntersectionObserver` — visibility handled by rect check in `positionTooltip()`
 *   - Click/dblclick delegated to global `hitTesting.ts` via `caretRangeFromPoint`
 *   - Single `Map<string, TranslationEntry>` replaces multiple separate Maps
 *   - Orphan detection uses `range.startContainer.isConnected` instead of `document.getElementById()`
 *
 * Helper modules (all inside `./translationDisplayV2/`):
 *   - `types.ts`           — shared type definitions and named constants
 *   - `tooltipLayout.ts`   — pure rect-normalisation and text-splitting utilities
 *   - `tooltipRenderer.ts` — tooltip DOM creation and content rendering
 *   - `hitTesting.ts`      — global click/dblclick via caretRangeFromPoint
 */

import type { TranslationContextData } from "@/0_common/types"
import * as types from "@/0_common/types"
import * as constants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import type { TranslationDetailData } from "@/1_content/ui/translationModal"
import * as translationModal from "@/1_content/ui/translationModal"
import * as lineHeightAdjuster from "@/1_content/utils/lineHeightAdjuster"
import { UNDERLINE_OFFSET_INTERNAL_SHIFT_PX } from "@/0_common/constants"
import * as loggerModule from "@/0_common/utils/logger"

import type { TranslationEntry, TranslationState, DisplayUserSettings } from "./translationDisplayV2/types"
import { VIEWPORT_PAD_PX } from "./translationDisplayV2/types"
import { getNormalizedLineRects, buildRectsSignature, splitTextAcrossRects } from "./translationDisplayV2/tooltipLayout"
import { isRectVisibleForSource } from "./translationDisplayV2/clipVisibility"
import {
    createTooltipElement,
    syncTooltipStyles,
    setTooltipText,
    setTooltipContentOffset,
    setTooltipBottomSpacing,
    renderTooltipContent,
} from "./translationDisplayV2/tooltipRenderer"
import * as hitTesting from "./translationDisplayV2/hitTesting"

export type { TranslationState, DisplayUserSettings }

const logger = loggerModule.createLogger("1_content/ui/translationDisplayV2")

// ============================================================================
// Shared State
// ============================================================================

/** Monotonically increasing counter used to generate unique translation IDs. */
let translationIdCounter = 0

/** Primary registry of active translations. Key: translation ID; Value: TranslationEntry. */
const activeTranslations = new Map<string, TranslationEntry>()

/** Cached rect signature per translation — used to skip redundant text-splits on identical layouts. */
const rectSignatureCache = new Map<string, string>()

/** Cached split text segments per translation for the current rect signature. */
const tooltipSegmentsCache = new Map<string, string[]>()

/**
 * Tracks which block-level element had its `line-height` adjusted per translation.
 * Required so we can restore it cleanly even after the translation is removed.
 */
const adjustedBlocks = new Map<string, HTMLElement>()

// ============================================================================
// Global Scroll / Resize Listener (lazy, shared across all active tooltips)
// ============================================================================

let globalRepositionAttached = false
let repositionScheduled = false
let interactionRepositionScheduled = false
let interactionObserver: MutationObserver | null = null
let interactionObserverStopTimer: number | undefined
let orphanObserver: MutationObserver | null = null
let orphanScanScheduled = false

const SCROLL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: true, capture: true }
const INTERACTION_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true }
const INTERACTION_OBSERVER_WINDOW_MS = 4000
const INTERACTION_ATTRIBUTE_FILTER = ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded"]

const scheduleReposition = () => {
    if (repositionScheduled) return
    repositionScheduled = true
    requestAnimationFrame(() => {
        repositionScheduled = false
        // Snapshot keys to avoid iterator invalidation if a tooltip is removed mid-loop.
        for (const id of Array.from(activeTranslations.keys())) {
            positionTooltip(id)
        }
    })
}

const scheduleInteractionReposition = () => {
    if (interactionRepositionScheduled) return
    interactionRepositionScheduled = true

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            interactionRepositionScheduled = false
            scheduleReposition()
        })
    })
}

function stopInteractionObserver(): void {
    if (interactionObserver) {
        interactionObserver.disconnect()
        interactionObserver = null
    }

    if (interactionObserverStopTimer !== undefined) {
        window.clearTimeout(interactionObserverStopTimer)
        interactionObserverStopTimer = undefined
    }
}

function startInteractionObserverWindow(): void {
    if (activeTranslations.size === 0 || !document.body) return

    if (!interactionObserver) {
        interactionObserver = new MutationObserver(() => {
            scheduleReposition()
        })
    } else {
        interactionObserver.disconnect()
    }

    interactionObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: INTERACTION_ATTRIBUTE_FILTER,
    })

    if (interactionObserverStopTimer !== undefined) {
        window.clearTimeout(interactionObserverStopTimer)
    }

    interactionObserverStopTimer = window.setTimeout(() => {
        stopInteractionObserver()
    }, INTERACTION_OBSERVER_WINDOW_MS)
}

function handleInteractionVisibilityRefresh(): void {
    scheduleInteractionReposition()
    startInteractionObserverWindow()
}

const scheduleOrphanScan = () => {
    if (orphanScanScheduled) return
    orphanScanScheduled = true

    requestAnimationFrame(() => {
        orphanScanScheduled = false
        for (const id of Array.from(activeTranslations.keys())) {
            const entry = activeTranslations.get(id)
            if (!entry) continue
            // V2: check Range connectivity instead of document.getElementById()
            if (!entry.range.startContainer.isConnected) {
                cleanupTranslationById(id, "orphan")
            }
        }
    })
}

function ensureGlobalRepositionListeners(): void {
    if (globalRepositionAttached) return

    window.addEventListener("scroll", scheduleReposition, SCROLL_LISTENER_OPTIONS)
    window.addEventListener("resize", scheduleReposition)
    document.addEventListener("click", handleInteractionVisibilityRefresh, INTERACTION_LISTENER_OPTIONS)
    globalRepositionAttached = true
}

function maybeDetachGlobalRepositionListeners(): void {
    if (globalRepositionAttached && activeTranslations.size === 0) {
        window.removeEventListener("scroll", scheduleReposition, SCROLL_LISTENER_OPTIONS)
        window.removeEventListener("resize", scheduleReposition)
        document.removeEventListener("click", handleInteractionVisibilityRefresh, INTERACTION_LISTENER_OPTIONS)
        globalRepositionAttached = false
        interactionRepositionScheduled = false
        stopInteractionObserver()
    }
}

function ensureOrphanObserver(): void {
    if (orphanObserver || !document.body) return

    orphanObserver = new MutationObserver(() => {
        scheduleOrphanScan()
    })

    orphanObserver.observe(document.body, {
        childList: true,
        subtree: true,
    })
}

function maybeDetachOrphanObserver(): void {
    if (orphanObserver && activeTranslations.size === 0) {
        orphanObserver.disconnect()
        orphanObserver = null
        orphanScanScheduled = false
    }
}

// ============================================================================
// Hit Test Integration
// ============================================================================

/** Attach global hit-test listeners, providing callbacks into the coordinator's state. */
function ensureHitTestListeners(): void {
    hitTesting.attachGlobalHitListeners({
        getActiveTranslations: () => {
            const map = new Map<string, { range: Range; tooltips: HTMLElement[]; creationTime: number }>()
            for (const [id, entry] of activeTranslations) {
                map.set(id, { range: entry.range, tooltips: entry.tooltips, creationTime: entry.creationTime })
            }
            return map
        },
        onTranslationClick: handleTranslationClick,
        onTranslationDblClick: handleTranslationDblClick,
        isSingleClickTranslateEnabled: () => contentIndex.getCachedUserSettings()?.singleClickTranslate ?? false,
    })
}

/** Detach hit-test listeners when no translations remain. */
function maybeDetachHitTestListeners(): void {
    if (activeTranslations.size === 0) {
        hitTesting.detachGlobalHitListeners()
    }
}

/** Open or close the detail modal for the given translation. */
function handleTranslationClick(id: string): void {
    if (translationModal.getActiveModalAnchorId() === id) {
        translationModal.closeTranslationModal()
        return
    }

    const entry = activeTranslations.get(id)
    if (!entry) {
        logger.warn("No translation data found for:", id)
        return
    }

    logger.info("Opening translation detail modal for:", id)
    // V2 passes Range for positioning — no anchor span exists
    translationModal.showTranslationModal(entry.translationData, entry.range, id)
}

/** Remove the translation on double-click and clear selection. */
function handleTranslationDblClick(id: string): void {
    if (translationModal.getActiveModalAnchorId() === id) {
        translationModal.closeTranslationModal()
    }

    logger.info("Double-click on translation, removing:", id)
    removeTranslationResult(id)
    window.getSelection()?.removeAllRanges()
}

// ============================================================================
// Tooltip Segment Management
// ============================================================================

/**
 * Ensure the translation entry holds exactly `count` tooltip elements.
 * Removes excess elements from the DOM; creates and appends new ones as needed.
 * New segments inherit styles and state classes from `baseTooltip` to stay visually consistent.
 *
 * @param id - The translation ID whose tooltip segment count to normalise.
 * @param count - The desired number of segments.
 * @param baseTooltip - Reference tooltip to copy styles from when creating new segments.
 * @returns The updated array of tooltip elements.
 */
function ensureTooltipSegmentCount(id: string, count: number, baseTooltip?: HTMLElement): HTMLElement[] {
    const entry = activeTranslations.get(id)
    if (!entry) return []

    const existing = entry.tooltips

    if (existing.length === count) {
        return existing
    }

    if (existing.length > count) {
        for (let i = count; i < existing.length; i++) {
            try { existing[i]?.remove() } catch { /* ignore */ }
        }
        entry.tooltips = existing.slice(0, count)
        return entry.tooltips
    }

    const next: HTMLElement[] = existing.slice()
    for (let i = existing.length; i < count; i++) {
        const tooltip = createTooltipElement()
        if (baseTooltip) {
            syncTooltipStyles(baseTooltip, tooltip)
            // Clone all state classes (e.g. `visible`) so the new segment is immediately
            // displayed at the correct opacity without re-triggering the fade-in animation.
            for (const cls of Array.from(baseTooltip.classList)) {
                tooltip.classList.add(cls)
            }
            if (baseTooltip.style.visibility) {
                tooltip.style.visibility = baseTooltip.style.visibility
            }
        }
        document.body.appendChild(tooltip)
        next.push(tooltip)
    }

    entry.tooltips = next
    return entry.tooltips
}

// ============================================================================
// Tooltip Positioning
// ============================================================================

/**
 * Compute and apply absolute `top`/`left` positions for every tooltip segment belonging
 * to a translation. Re-splits the translation text across line rects only when the rect
 * signature changes, so repeated scroll events are cheap.
 *
 * @param id - Identifier of the translation whose tooltips need positioning.
 */
function positionTooltip(id: string): void {
    const entry = activeTranslations.get(id)
    if (!entry || entry.tooltips.length === 0) return

    // V2 orphan check: Range still connected to the document?
    if (!entry.range.startContainer.isConnected) {
        cleanupTranslationById(id, "orphan")
        return
    }

    const rects = getNormalizedLineRects(entry.range)
    const sourceElement = entry.range.startContainer.parentElement
    const visibleRectFlags = rects.map((rect) => isRectVisibleForSource(rect, sourceElement, entry.range))
    const hasVisibleRect = visibleRectFlags.some(Boolean)

    if (!hasVisibleRect) {
        // Range is fully clipped by its container chain — hide tooltips like V1 did.
        for (const tooltip of entry.tooltips) tooltip.style.visibility = "hidden"
        return
    }

    const lineRects = rects
    // position: fixed — top/left are relative to the viewport, so clientRect
    // values can be used directly without scroll offset. This also fixes Firefox
    // misalignment on pages with CSS transform/filter/will-change ancestors.
    const viewportWidth = document.documentElement.clientWidth

    const signature = buildRectsSignature(lineRects)
    const lastSignature = rectSignatureCache.get(id)
    const baseTooltip = entry.tooltips[0]
    if (!baseTooltip) return

    const isSpinner = baseTooltip.dataset.loadingVariant === "spinner"

    // Re-split text only when the layout actually changes.
    if (signature !== lastSignature) {
        rectSignatureCache.set(id, signature)

        if (isSpinner) {
            tooltipSegmentsCache.set(id, [])
        } else {
            const raw = baseTooltip.dataset.sourceText || baseTooltip.dataset.fullText || baseTooltip.textContent || ""
            const widths = lineRects.map((r) => r.width)
            const split = splitTextAcrossRects(raw, widths, baseTooltip)
            tooltipSegmentsCache.set(id, split)
        }
    }

    const cached = tooltipSegmentsCache.get(id) || []
    // In V2 each tooltip line also renders the underline, so we need one tooltip
    // per selected source line even when the translated text fits into fewer lines.
    const desiredCount = Math.max(1, lineRects.length)
    const segments = ensureTooltipSegmentCount(id, desiredCount, baseTooltip)

    const isSingleLine = segments.length === 1
    const segs = entry.tooltips

    const cachedSettings = contentIndex.getCachedUserSettings()
    const underlineOffsetSetting = cachedSettings?.tooltipUnderlineOffsetPxV3 ?? types.DEFAULT_USER_SETTINGS.tooltipUnderlineOffsetPxV3
    const underlineOffset = underlineOffsetSetting - UNDERLINE_OFFSET_INTERNAL_SHIFT_PX
    const contentOffsetFromUnderline = cachedSettings?.tooltipTextOffsetPxV3 ?? types.DEFAULT_USER_SETTINGS.tooltipTextOffsetPxV3
    const bottomSpacing = cachedSettings?.tooltipBottomSpacingPxV3 ?? types.DEFAULT_USER_SETTINGS.tooltipBottomSpacingPxV3

    for (let i = 0; i < segs.length; i++) {
        const tooltip = segs[i]
        const rect = lineRects[Math.min(i, lineRects.length - 1)]
        if (!tooltip || !rect) continue

        const isVisible = visibleRectFlags[Math.min(i, visibleRectFlags.length - 1)] ?? false
        tooltip.style.visibility = isVisible ? "visible" : "hidden"
        if (!isVisible) continue

        const isLastLine = i === segs.length - 1

        if (!document.body.contains(tooltip)) {
            document.body.appendChild(tooltip)
        }

        tooltip.style.position = "fixed"
        tooltip.style.transform = "none"
        tooltip.style.marginTop = "0px"

        const rectWidth = rect.width
        tooltip.style.minWidth = `${rectWidth}px`
        tooltip.style.maxWidth = `${rectWidth}px`
        tooltip.style.textAlign = isSingleLine ? "center" : "left"

        const hasContent = isSpinner ? i === 0 : Boolean(cached[i] ?? "")
        setTooltipContentOffset(tooltip, hasContent ? contentOffsetFromUnderline : 0)
        setTooltipBottomSpacing(tooltip, hasContent ? bottomSpacing : 0)

        if (!isSpinner) {
            setTooltipText(tooltip, cached[i] ?? "", rectWidth, isLastLine)
        }

        const top = rect.bottom + underlineOffset
        const tooltipWidth = tooltip.offsetWidth || 0

        let left: number
        if (isSingleLine) {
            const idealLeft = rect.left + (rect.width - tooltipWidth) / 2
            left = Math.max(VIEWPORT_PAD_PX, Math.min(idealLeft, viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        } else {
            // Multi-line: left-align each segment to its own rect.
            left = rect.left
            left = Math.max(VIEWPORT_PAD_PX, Math.min(left, viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        }

        tooltip.style.top = `${top}px`
        tooltip.style.left = `${left}px`
    }
}

// ============================================================================
// Cleanup Helpers
// ============================================================================

/**
 * Full cleanup for a single translation by ID:
 *   1. Removes tooltip elements from the DOM.
 *   2. Restores any adjusted `line-height` on the block ancestor.
 *   3. Purges all related entries from the shared state.
 *
 * No anchor unwrapping needed — V2 never creates anchor spans.
 *
 * @param id - The ID of the translation to remove.
 * @param reason - "remove" for explicit user action; "orphan" for DOM eviction by the host page.
 */
function cleanupTranslationById(id: string, reason: "remove" | "orphan" = "remove"): void {
    const entry = activeTranslations.get(id)
    if (!entry) return

    // Remove tooltips from DOM
    for (const tooltip of entry.tooltips) {
        try { tooltip.remove() } catch { /* ignore */ }
    }

    // Restore line-height
    const mappedBlock = adjustedBlocks.get(id)
    if (mappedBlock) {
        try {
            const cachedSettings = contentIndex.getCachedUserSettings()
            const shouldRestore = cachedSettings?.restoreLineHeightOnClear ?? false
            // Always call restore to update internal ref-counts; DOM restoration is conditional.
            lineHeightAdjuster.restoreLineHeight(mappedBlock, !shouldRestore)
        } catch (e) {
            logger.warn("Failed to restore line-height via mapped block:", id, e)
        } finally {
            adjustedBlocks.delete(id)
        }
    }

    // No unwrapAnchorElement needed — V2 never creates anchor spans.

    activeTranslations.delete(id)
    rectSignatureCache.delete(id)
    tooltipSegmentsCache.delete(id)

    maybeDetachGlobalRepositionListeners()
    maybeDetachOrphanObserver()
    maybeDetachHitTestListeners()

    if (reason === "orphan") {
        logger.warn("Orphan translation cleaned:", id)
    } else {
        logger.info("Translation removed:", id)
    }
}

/** Remove any orphaned tooltip elements not tracked in state. */
function removeUntrackedTooltipElements(): void {
    const trackedTooltips = new Set<HTMLElement>()
    for (const entry of activeTranslations.values()) {
        for (const tooltip of entry.tooltips) trackedTooltips.add(tooltip)
    }

    for (const node of Array.from(document.querySelectorAll(`.${constants.CSS_CLASSES.TOOLTIP}`))) {
        if (node instanceof HTMLElement && !trackedTooltips.has(node)) {
            node.remove()
        }
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Remove a single translation from the page and clean up all associated state.
 *
 * @param translationId - The ID returned by `showTranslationResult`.
 */
/**
 * Get a Map of all active translation Ranges, keyed by translation ID.
 * Used by `translationOverlapDetectorV2` to detect overlapping selections.
 */
export function getActiveRanges(): Map<string, Range> {
    const map = new Map<string, Range>()
    for (const [id, entry] of activeTranslations) {
        map.set(id, entry.range)
    }
    return map
}

/**
 * Check whether a screen point falls inside any active translation Range.
 * Used by `selectionValidator` to suppress re-translation of already-translated text.
 *
 * @param x - clientX of the click/selection point.
 * @param y - clientY of the click/selection point.
 * @returns `true` if the point is inside an active translation.
 */
export function isPointInsideActiveTranslation(x: number, y: number): boolean {
    return hitTesting.isPointInsideAnyActiveTranslation(x, y)
}

/**
 * Remove a single translation from the page and clean up all associated state.
 *
 * @param translationId - The ID returned by `showTranslationResult`.
 */
export function removeTranslationResult(translationId: string): void {
    try {
        cleanupTranslationById(translationId, "remove")
    } catch (error) {
        logger.error("Error removing translation:", error)
    }
}

/**
 * Remove every active translation from the page.
 * Also purges any "orphaned" tooltip elements that are no longer tracked in state.
 */
export function removeAllTranslationResults(): void {
    try {
        for (const id of Array.from(activeTranslations.keys())) {
            cleanupTranslationById(id, "remove")
        }

        // No removeUntrackedAnchorElements() — V2 never creates anchor spans.
        removeUntrackedTooltipElements()
        translationModal.closeTranslationModal()

        logger.info("All translation results removed")
    } catch (error) {
        logger.error("Error removing all translations:", error)
    }
}

/**
 * Display a translation annotation for the given text selection.
 *
 * V2: Does NOT wrap the selection in an anchor `<span>`. Instead, clones the Range
 * and stores it as a live reference. Tooltips are portalled to `document.body`.
 *
 * @param range - The `Range` object representing the selected text.
 * @param selectedText - The raw selected string (stored for the detail modal).
 * @param state - Initial display state (`loading`, `success`, or `error`).
 * @param context - Surrounding sentence context used by the AI and shown in the modal.
 * @param onRefresh - Optional callback to re-trigger translation (shown as a refresh button in modal).
 * @param translationType - `"word"` or `"fragment"` — affects tooltip styling.
 * @param userSettings - Optional per-call overrides for font size and height adjustment.
 * @returns The unique translation ID, used to update or remove the annotation later.
 */
export function showTranslationResult(
    range: Range,
    selectedText: string,
    state: TranslationState,
    context?: TranslationContextData,
    onRefresh?: () => void,
    translationType: "word" | "fragment" = "word",
    userSettings?: DisplayUserSettings
): string {
    try {
        const id = `translation-${translationIdCounter++}`

        // V2: No extractContents, no insertNode, no span creation.
        // Just clone the range to keep a live reference to the original text.
        const storedRange = range.cloneRange()
        const originalElement = range.startContainer.parentElement

        const tooltip = createTooltipElement()
        // Add fragment class for CSS border-top color differentiation
        if (translationType === "fragment") {
            tooltip.classList.add("ai-translator-tooltip--fragment")
        }

        const styleResult = renderTooltipContent(tooltip, state, originalElement, userSettings)

        // Line-height adjustment: use range.startContainer.parentElement as anchor substitute
        const autoAdjustHeight = userSettings?.autoAdjustHeight ?? contentIndex.getCachedUserSettings()?.autoAdjustHeight ?? true
        let didAdjustLineHeight = false
        if (autoAdjustHeight && styleResult?.spaceCalculation) {
            const parentElement = storedRange.startContainer.parentElement
            const adjustmentResult = lineHeightAdjuster.adjustLineHeightIfNeeded(parentElement, styleResult.spaceCalculation)
            if (adjustmentResult.blockElement) {
                adjustedBlocks.set(id, adjustmentResult.blockElement)
            }
            didAdjustLineHeight = adjustmentResult.didAdjustLineHeight
        }

        document.body.appendChild(tooltip)

        const translationData: TranslationDetailData = {
            status: state.status,
            translationType,
            text: selectedText,
            translation: state.status === "success" ? state.translation : "",
            originalSentence: context?.originalSentence,
            sentenceTranslation: state.status === "success" ? state.sentenceTranslation : undefined,
            leadingText: context?.leadingText,
            trailingText: context?.trailingText,
            errorMessage: state.status === "error" ? state.errorMessage || state.text : undefined,
            chineseDefinition: state.status === "success" ? state.chineseDefinition : undefined,
            englishDefinition: state.status === "success" ? state.englishDefinition : undefined,
            targetDefinition: state.status === "success" ? state.targetDefinition : undefined,
            targetLanguage: state.status === "success" ? state.targetLanguage : undefined,
            lemma: state.status === "success" ? state.lemma : undefined,
            phonetic: state.status === "success" ? state.phonetic : undefined,
            lemmaPhonetic: state.status === "success" ? state.lemmaPhonetic : undefined,
            sourceLanguage: context?.sourceLanguage,
            onDelete: () => removeTranslationResult(id),
            onRefresh,
        }

        const entry: TranslationEntry = {
            id,
            range: storedRange,
            tooltips: [tooltip],
            translationData,
            originalText: selectedText,
            translationType,
            creationTime: Date.now(),
        }
        activeTranslations.set(id, entry)

        ensureOrphanObserver()
        positionTooltip(id)
        if (didAdjustLineHeight) {
            // A real line-height change can push lower content down immediately.
            // Keep the new tooltip on the fast path, then resync all others on the next frame.
            scheduleReposition()
        }
        ensureGlobalRepositionListeners()
        ensureHitTestListeners()

        // Fade-in: add `visible` class after a short delay so the CSS transition plays.
        // Re-position after the transition starts to account for size changes during fade.
        const FADE_IN_DELAY_MS = 10
        setTimeout(() => {
            const e = activeTranslations.get(id)
            if (e) {
                for (const seg of e.tooltips) seg.classList.add("visible")
            }
            positionTooltip(id)
        }, FADE_IN_DELAY_MS)

        logger.info("Translation displayed:", id, state)
        return id
    } catch (error) {
        logger.error("Error showing translation:", error)
        return "fallback-id"
    }
}

/**
 * Update the tooltip content and stored data of an existing translation.
 * If the detail modal is currently showing this translation, it is automatically refreshed.
 *
 * @param translationId - The ID returned by `showTranslationResult`.
 * @param state - The new display state to render.
 * @param userSettings - Optional per-call overrides for font size.
 */
export function updateTranslationResult(translationId: string, state: TranslationState, userSettings?: DisplayUserSettings): void {
    try {
        const entry = activeTranslations.get(translationId)
        if (!entry || entry.tooltips.length === 0) {
            logger.warn("Translation tooltip not found for ID:", translationId)
            return
        }

        const tooltip = entry.tooltips[0]
        if (!tooltip) return

        // V2: use range.startContainer.parentElement instead of anchor.parentElement
        const originalElement = entry.range.startContainer.parentElement ?? null

        renderTooltipContent(tooltip, state, originalElement, userSettings)
        // Clear signature cache so the next position call re-splits text for the new content.
        rectSignatureCache.delete(translationId)
        positionTooltip(translationId)

        const existingData = entry.translationData
        const updatedData: TranslationDetailData = {
            ...existingData,
            status: state.status,
            translation: state.status === "success" ? state.translation : existingData.translation,
            sentenceTranslation: state.status === "success" ? state.sentenceTranslation : existingData.sentenceTranslation,
            errorMessage: state.status === "error" ? state.errorMessage || state.text : undefined,
            chineseDefinition: state.status === "success" ? state.chineseDefinition : existingData.chineseDefinition,
            englishDefinition: state.status === "success" ? state.englishDefinition : existingData.englishDefinition,
            targetDefinition: state.status === "success" ? state.targetDefinition : existingData.targetDefinition,
            targetLanguage: state.status === "success" ? state.targetLanguage : existingData.targetLanguage,
            lemma: state.status === "success" ? state.lemma : existingData.lemma,
            phonetic: state.status === "success" ? state.phonetic : existingData.phonetic,
            lemmaPhonetic: state.status === "success" ? state.lemmaPhonetic : existingData.lemmaPhonetic,
        }
        entry.translationData = updatedData

        if (translationModal.getActiveModalAnchorId() === translationId) {
            logger.info("Auto-refreshing modal for translation:", translationId)
            translationModal.updateTranslationModal(updatedData)
        }

        logger.info("Translation updated:", translationId, state)
    } catch (error) {
        logger.error("Error updating translation:", error)
    }
}
