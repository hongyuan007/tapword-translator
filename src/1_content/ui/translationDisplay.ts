/**
 * @file translationDisplay.ts
 * Coordinator for the translation display subsystem.
 *
 * Owns all shared mutable state (anchor maps, observer registry, reposition flags),
 * orchestrates the full lifecycle of a translation annotation:
 *   1. Wrapping selected text in an anchor `<span>`
 *   2. Appending tooltip portal(s) to `document.body`
 *   3. Positioning / repositioning tooltips on scroll and resize
 *   4. Hiding tooltips when the anchor scrolls out of a clipped container
 *   5. Cleaning up anchors, tooltips, and observers on removal
 *
 * Helper modules (all inside `./translationDisplay/`):
 *   - `types.ts`          — shared type definitions and named constants
 *   - `tooltipLayout.ts`  — pure rect-normalisation and text-splitting utilities
 *   - `tooltipRenderer.ts`— tooltip DOM creation and content rendering
 */

import type { TranslationContextData } from "@/0_common/types"
import * as types from "@/0_common/types"
import * as constants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import type { TranslationDetailData } from "@/1_content/ui/translationModal"
import * as translationModal from "@/1_content/ui/translationModal"
import * as lineHeightAdjuster from "@/1_content/utils/lineHeightAdjuster"
import * as loggerModule from "@/0_common/utils/logger"

import type { TranslationState, DisplayUserSettings } from "./translationDisplay/types"
import { CLICK_DEBOUNCE_DELAY_MS, INTERACTION_GRACE_PERIOD_MS, VIEWPORT_PAD_PX } from "./translationDisplay/types"
import { getNormalizedLineRects, buildRectsSignature, splitTextAcrossRects } from "./translationDisplay/tooltipLayout"
import {
    createTooltipElement,
    syncTooltipStyles,
    setTooltipText,
    renderTooltipContent,
} from "./translationDisplay/tooltipRenderer"

export type { TranslationState, DisplayUserSettings }

const logger = loggerModule.createLogger("1_content/ui/translationDisplay")

// ============================================================================
// Shared State
// ============================================================================

/** Monotonically increasing counter used to generate unique anchor element IDs. */
let anchorIdCounter = 0

/**
 * Primary registry of active translations.
 * Key: anchor ID; Value: tooltip segment elements appended to `document.body`.
 *
 * Single-line selections have exactly one tooltip; multi-line selections have one per visual line.
 */
const activeTranslations = new Map<string, HTMLElement[]>()

/** Cached rect signature per anchor — used to skip redundant text-splits on identical layouts. */
const anchorRectSignatureCache = new Map<string, string>()

/** Cached split text segments per anchor for the current rect signature. */
const anchorTooltipSegmentsCache = new Map<string, string[]>()

/** Full translation detail data per anchor — fed into the detail modal on click. */
const translationDataMap = new Map<string, TranslationDetailData>()

/**
 * Tracks which block-level element had its `line-height` adjusted per anchor.
 * Required so we can restore it cleanly even if the anchor element is already gone.
 */
const anchorAdjustedBlocks = new Map<string, HTMLElement>()

/** `IntersectionObserver` instances per anchor, used to hide tooltips in scrollable containers. */
const anchorObservers = new Map<string, IntersectionObserver>()

// ============================================================================
// Global Scroll / Resize Listener (lazy, shared across all active tooltips)
// ============================================================================

let globalRepositionAttached = false
let repositionScheduled = false
let orphanObserver: MutationObserver | null = null
let orphanScanScheduled = false

const SCROLL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: true, capture: true }

const scheduleReposition = () => {
    if (repositionScheduled) return
    repositionScheduled = true
    requestAnimationFrame(() => {
        repositionScheduled = false
        // Snapshot keys to avoid iterator invalidation if a tooltip is removed mid-loop.
        for (const anchorId of Array.from(activeTranslations.keys())) {
            positionTooltip(anchorId)
        }
    })
}

const scheduleOrphanScan = () => {
    if (orphanScanScheduled) return
    orphanScanScheduled = true

    requestAnimationFrame(() => {
        orphanScanScheduled = false
        for (const anchorId of Array.from(activeTranslations.keys())) {
            if (!document.getElementById(anchorId)) {
                cleanupTranslationById(anchorId, null, "orphan")
            }
        }
    })
}

function ensureGlobalRepositionListeners(): void {
    if (globalRepositionAttached) return

    window.addEventListener("scroll", scheduleReposition, SCROLL_LISTENER_OPTIONS)
    window.addEventListener("resize", scheduleReposition)
    globalRepositionAttached = true
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

function maybeDetachGlobalRepositionListeners(): void {
    if (globalRepositionAttached && activeTranslations.size === 0) {
        window.removeEventListener("scroll", scheduleReposition, SCROLL_LISTENER_OPTIONS)
        window.removeEventListener("resize", scheduleReposition)
        globalRepositionAttached = false
    }
}

function maybeDetachOrphanObserver(): void {
    if (orphanObserver && activeTranslations.size === 0) {
        orphanObserver.disconnect()
        orphanObserver = null
        orphanScanScheduled = false
    }
}

// ============================================================================
// Tooltip Segment Management
// ============================================================================

/**
 * Ensure the `activeTranslations` map holds exactly `count` tooltip elements for `anchorId`.
 * Removes excess elements from the DOM; creates and appends new ones as needed.
 * New segments inherit styles and state classes from `baseTooltip` to stay visually consistent
 * (e.g. inheriting the `visible` class so they don't appear unanimated on reflow).
 *
 * @param anchorId - The anchor whose tooltip segment count to normalise.
 * @param count - The desired number of segments.
 * @param baseTooltip - Reference tooltip to copy styles from when creating new segments.
 * @returns The updated array of tooltip elements.
 */
function ensureTooltipSegmentCount(anchorId: string, count: number, baseTooltip?: HTMLElement): HTMLElement[] {
    const existing = activeTranslations.get(anchorId) || []

    if (existing.length === count) {
        return existing
    }

    if (existing.length > count) {
        for (let i = count; i < existing.length; i++) {
            try { existing[i]?.remove() } catch { /* ignore */ }
        }
        const trimmed = existing.slice(0, count)
        activeTranslations.set(anchorId, trimmed)
        return trimmed
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

    activeTranslations.set(anchorId, next)
    return next
}

// ============================================================================
// Tooltip Positioning
// ============================================================================

/**
 * Compute and apply absolute `top`/`left` positions for every tooltip segment belonging
 * to `anchorId`.  Re-splits the translation text across line rects only when the rect
 * signature changes, so repeated scroll events are cheap.
 *
 * Called on initial render and on every scroll/resize event via the global listener.
 *
 * @param anchorId - Identifier of the anchor whose tooltips need positioning.
 */
function positionTooltip(anchorId: string): void {
    const tooltips = activeTranslations.get(anchorId)
    if (!tooltips || tooltips.length === 0) return

    const anchor = document.getElementById(anchorId)
    if (!anchor) {
        // Host page removed the anchor (e.g. Reddit virtualised list, SPA route change).
        cleanupTranslationById(anchorId, null, "orphan")
        return
    }

    const rects = getNormalizedLineRects(anchor)
    const lineRects = rects.length > 0 ? rects : [anchor.getBoundingClientRect()]
    if (lineRects.length === 0) return

    // On pages where <body> is the scroll container (e.g. position:relative + overflow-y:auto),
    // window.scrollY stays 0 while body.scrollTop accumulates.  We add body.scrollTop only
    // when the window scroll is 0, avoiding double-counting in Quirks Mode pages where both
    // window.scrollY and document.body.scrollTop reflect the same offset simultaneously.
    const winScrollX = window.scrollX || document.documentElement.scrollLeft || 0
    const winScrollY = window.scrollY || document.documentElement.scrollTop  || 0
    const scrollX = winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0)
    const scrollY = winScrollY + (winScrollY === 0 ? (document.body?.scrollTop  || 0) : 0)
    const viewportWidth = document.documentElement.clientWidth

    const signature = buildRectsSignature(lineRects)
    const lastSignature = anchorRectSignatureCache.get(anchorId)
    const baseTooltip = tooltips[0]
    if (!baseTooltip) return

    const isSpinner = baseTooltip.dataset.loadingVariant === "spinner"

    // Re-split text only when the layout actually changes.
    if (signature !== lastSignature) {
        anchorRectSignatureCache.set(anchorId, signature)

        if (isSpinner) {
            anchorTooltipSegmentsCache.set(anchorId, [])
        } else {
            const raw = baseTooltip.dataset.sourceText || baseTooltip.dataset.fullText || baseTooltip.textContent || ""
            const widths = lineRects.map((r) => r.width)
            const split = splitTextAcrossRects(raw, widths, baseTooltip)
            anchorTooltipSegmentsCache.set(anchorId, split)
        }
    }

    const cached = anchorTooltipSegmentsCache.get(anchorId) || []
    const desiredCount = isSpinner ? 1 : Math.max(1, cached.length)
    const segments = ensureTooltipSegmentCount(anchorId, desiredCount, baseTooltip)

    const isSingleLine = segments.length === 1
    const segs = activeTranslations.get(anchorId) || []

    const cachedSettings = contentIndex.getCachedUserSettings()
    const verticalOffset = cachedSettings?.tooltipVerticalOffsetPxV2 ?? types.DEFAULT_USER_SETTINGS.tooltipVerticalOffsetPxV2

    for (let i = 0; i < segs.length; i++) {
        const tooltip = segs[i]
        const rect = lineRects[Math.min(i, lineRects.length - 1)]
        if (!tooltip || !rect) continue

        const isLastLine = i === segs.length - 1

        if (!document.body.contains(tooltip)) {
            document.body.appendChild(tooltip)
        }

        tooltip.style.position = "absolute"
        tooltip.style.transform = "none"
        tooltip.style.marginTop = "0px"

        const rectWidth = rect.width
        tooltip.style.maxWidth = `${rectWidth}px`

        if (!isSpinner) {
            setTooltipText(tooltip, cached[i] ?? "", rectWidth, isLastLine)
        }

        const top = rect.bottom + scrollY + verticalOffset
        const tooltipWidth = tooltip.offsetWidth || 0

        let left: number
        if (isSingleLine) {
            const idealLeft = rect.left + scrollX + (rect.width - tooltipWidth) / 2
            left = Math.max(scrollX + VIEWPORT_PAD_PX, Math.min(idealLeft, scrollX + viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        } else {
            // Multi-line: left-align each segment to its own rect.
            left = rect.left + scrollX
            left = Math.max(scrollX + VIEWPORT_PAD_PX, Math.min(left, scrollX + viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        }

        tooltip.style.top = `${top}px`
        tooltip.style.left = `${left}px`
    }
}

// ============================================================================
// Visibility Observer (scrollable containers)
// ============================================================================

/**
 * Walk up the DOM tree to find the first ancestor that is independently scrollable.
 * Returns `null` if no such ancestor exists, indicating that the main viewport is the scroller.
 *
 * @param element - The element to start searching from.
 * @returns The nearest scrollable ancestor, or `null`.
 */
function findScrollableParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement

    while (parent && parent.tagName !== "HTML") {
        const styles = window.getComputedStyle(parent)
        const overflowY = styles.getPropertyValue("overflow-y")
        const overflowX = styles.getPropertyValue("overflow-x")

        if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
            return parent
        }
        if ((overflowX === "auto" || overflowX === "scroll") && parent.scrollWidth > parent.clientWidth) {
            return parent
        }

        parent = parent.parentElement
    }

    return null
}

/**
 * Attach an `IntersectionObserver` to hide/show tooltip segments whenever the anchor
 * enters or leaves its scrollable container's viewport.
 *
 * Skipped for anchors in the main viewport (no scrollable parent) because tooltips
 * are portalled to `document.body` and are therefore never clipped by the viewport.
 *
 * @param anchorId - Identifier of the anchor to observe.
 * @param anchor - The anchor element itself.
 */
function setupVisibilityObserver(anchorId: string, anchor: HTMLElement): void {
    try {
        const scrollParent = findScrollableParent(anchor)
        if (!scrollParent) {
            logger.info(`[Visibility Observer] Skipped for anchor: ${anchorId} (no scrollable parent, using viewport)`)
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const tooltips = activeTranslations.get(anchorId) || []
                    const visibility = entry.isIntersecting ? "visible" : "hidden"
                    for (const tooltip of tooltips) {
                        tooltip.style.visibility = visibility
                    }
                })
            },
            {
                root: scrollParent,
                threshold: 0, // Trigger as soon as even 1px enters or leaves the container.
            }
        )

        observer.observe(anchor)
        anchorObservers.set(anchorId, observer)

        logger.info(`[Visibility Observer] Set up for anchor: ${anchorId}, scrollParent: ${scrollParent.tagName}`)
    } catch (error) {
        logger.warn(`[Visibility Observer] Failed to set up for anchor: ${anchorId}`, error)
    }
}

// ============================================================================
// Cleanup Helpers
// ============================================================================

/**
 * Full cleanup for a single translation by ID:
 *   1. Removes tooltip elements from the DOM.
 *   2. Disconnects the `IntersectionObserver`.
 *   3. Restores any adjusted `line-height` on the block ancestor.
 *   4. Unwraps the anchor `<span>` (if still present).
 *   5. Purges all related entries from the shared state maps.
 *
 * @param anchorId - The ID of the translation to remove.
 * @param anchorElement - The anchor element, if available (may be `null` for orphan cleanup).
 * @param reason - "remove" for explicit user action; "orphan" for DOM eviction by the host page.
 */
function cleanupTranslationById(anchorId: string, anchorElement?: HTMLElement | null, reason: "remove" | "orphan" = "remove"): void {
    const tooltips = activeTranslations.get(anchorId)
    if (tooltips && tooltips.length > 0) {
        for (const tooltip of tooltips) {
            try { tooltip.remove() } catch { /* ignore */ }
        }
    }

    const observer = anchorObservers.get(anchorId)
    if (observer) {
        try {
            observer.disconnect()
        } catch (e) {
            logger.warn("[translationDisplay] Failed to disconnect observer:", anchorId, e)
        } finally {
            anchorObservers.delete(anchorId)
        }
    }

    const mappedBlock = anchorAdjustedBlocks.get(anchorId)
    if (mappedBlock) {
        try {
            const cachedSettings = contentIndex.getCachedUserSettings()
            const shouldRestore = cachedSettings?.restoreLineHeightOnClear ?? false
            // Always call restore to update internal ref-counts; DOM restoration is conditional.
            lineHeightAdjuster.restoreLineHeight(mappedBlock, !shouldRestore)
        } catch (e) {
            logger.warn("[translationDisplay] Failed to restore line-height via mapped block:", anchorId, e)
        } finally {
            anchorAdjustedBlocks.delete(anchorId)
        }
    }

    if (anchorElement && anchorElement.parentNode) {
        const parent = anchorElement.parentNode
        try {
            anchorElement.replaceWith(...Array.from(anchorElement.childNodes))
            // Merge adjacent text nodes left behind by the unwrap operation.
            parent.normalize()
        } catch (e) {
            logger.warn("[translationDisplay] Failed to unwrap anchor:", anchorId, e)
        }
    }

    activeTranslations.delete(anchorId)
    anchorRectSignatureCache.delete(anchorId)
    anchorTooltipSegmentsCache.delete(anchorId)
    translationDataMap.delete(anchorId)
    maybeDetachGlobalRepositionListeners()
    maybeDetachOrphanObserver()

    const tag = anchorElement ? anchorElement.tagName.toLowerCase() : "(missing)"
    if (reason === "orphan") {
        logger.warn("[translationDisplay] Orphan tooltip cleaned and state removed:", anchorId, `anchor=${tag}`)
    } else {
        logger.info("Translation removed:", anchorId)
    }
}

function unwrapAnchorElement(anchorElement: HTMLElement): void {
    if (!anchorElement.parentNode) return

    const parent = anchorElement.parentNode
    try {
        anchorElement.replaceWith(...Array.from(anchorElement.childNodes))
        parent.normalize()
    } catch (error) {
        logger.warn("[translationDisplay] Failed to unwrap untracked anchor:", error)
    }
}

function removeUntrackedAnchorElements(): void {
    for (const anchor of Array.from(document.querySelectorAll(`.${constants.CSS_CLASSES.ANCHOR}`))) {
        if (!(anchor instanceof HTMLElement)) continue

        const { id } = anchor
        if (!id || !activeTranslations.has(id)) {
            unwrapAnchorElement(anchor)
        }
    }
}

function removeUntrackedTooltipElements(): void {
    const trackedTooltips = new Set<HTMLElement>()
    for (const tooltips of activeTranslations.values()) {
        for (const tooltip of tooltips) trackedTooltips.add(tooltip)
    }

    for (const node of Array.from(document.querySelectorAll(`.${constants.CSS_CLASSES.TOOLTIP}`))) {
        if (node instanceof HTMLElement && !trackedTooltips.has(node)) {
            node.remove()
        }
    }
}

// ============================================================================
// Anchor Event Handling
// ============================================================================

/**
 * Open or close the detail modal for the given anchor.
 * Toggling: if the modal is already open for this anchor, it closes instead.
 *
 * @param anchorId - The anchor whose detail modal should be toggled.
 */
function handleAnchorClick(anchorId: string): void {
    if (translationModal.getActiveModalAnchorId() === anchorId) {
        translationModal.closeTranslationModal()
        return
    }

    const data = translationDataMap.get(anchorId)
    if (!data) {
        logger.warn("No translation data found for anchor:", anchorId)
        return
    }

    const anchorElement = document.getElementById(anchorId)
    logger.info("Opening translation detail modal for:", anchorId)
    translationModal.showTranslationModal(data, anchorElement, anchorId)
}

/**
 * Attach click and double-click listeners to an anchor element.
 *
 * - **Single click** (debounced): opens the detail modal.
 * - **Double click**: removes the translation and clears the selection.
 *
 * Both handlers include a creation-time grace period to suppress accidental
 * triggers when the anchor is created immediately by a single-click translate action.
 *
 * @param anchor - The anchor `<span>` element.
 * @param anchorId - The unique ID of the anchor.
 */
function attachAnchorEventListeners(anchor: HTMLElement, anchorId: string): void {
    const creationTime = Date.now()
    let clickTimer: number | undefined

    anchor.addEventListener("click", (e) => {
        e.stopPropagation()

        const settings = contentIndex.getCachedUserSettings()
        if (settings?.singleClickTranslate && Date.now() - creationTime < INTERACTION_GRACE_PERIOD_MS) {
            return
        }

        if (clickTimer) window.clearTimeout(clickTimer)

        clickTimer = window.setTimeout(() => {
            handleAnchorClick(anchorId)
            clickTimer = undefined
        }, CLICK_DEBOUNCE_DELAY_MS)
    })

    anchor.addEventListener("dblclick", (e) => {
        e.stopPropagation()
        e.preventDefault()

        const settings = contentIndex.getCachedUserSettings()
        if (settings?.singleClickTranslate && Date.now() - creationTime < INTERACTION_GRACE_PERIOD_MS) {
            return
        }

        if (clickTimer) {
            window.clearTimeout(clickTimer)
            clickTimer = undefined
        }

        if (translationModal.getActiveModalAnchorId() === anchorId) {
            translationModal.closeTranslationModal()
        }

        logger.info("Double-click on anchor, removing:", anchorId)
        removeTranslationResult(anchorId)
        window.getSelection()?.removeAllRanges()
    })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Remove a single translation annotation from the page and clean up all associated state.
 *
 * @param anchorId - The ID returned by `showTranslationResult`.
 */
export function removeTranslationResult(anchorId: string): void {
    try {
        const anchor = document.getElementById(anchorId)
        cleanupTranslationById(anchorId, anchor, "remove")
    } catch (error) {
        logger.error("Error removing translation:", error)
    }
}

/**
 * Remove every active translation annotation from the page.
 * Also purges any "orphaned" anchor/tooltip elements that are no longer tracked in state.
 *
 * Primarily used during SPA navigations where the host page reuses DOM nodes
 * (e.g. YouTube video transitions) and previously injected elements must be fully cleared.
 */
export function removeAllTranslationResults(): void {
    try {
        for (const anchorId of Array.from(activeTranslations.keys())) {
            const anchor = document.getElementById(anchorId)
            cleanupTranslationById(anchorId, anchor, "remove")
        }

        removeUntrackedAnchorElements()
        removeUntrackedTooltipElements()
        translationModal.closeTranslationModal()

        logger.info("All translation results removed")
    } catch (error) {
        logger.error("Error removing all translations:", error)
    }
}

/**
 * Inject a translation annotation into the page for the given text selection.
 *
 * Wraps the selection in a styled anchor `<span>`, appends a tooltip portal to
 * `document.body`, and sets up scroll-tracking and visibility observation.
 *
 * @param range - The `Range` object representing the selected text.
 * @param selectedText - The raw selected string (stored for the detail modal).
 * @param state - Initial display state (`loading`, `success`, or `error`).
 * @param context - Surrounding sentence context used by the AI and shown in the modal.
 * @param onRefresh - Optional callback to re-trigger translation (shown as a refresh button in modal).
 * @param translationType - `"word"` or `"fragment"` — affects anchor styling.
 * @param userSettings - Optional per-call overrides for font size and height adjustment.
 * @returns The unique anchor ID, used to update or remove the annotation later.
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
        const anchorId = `translation-anchor-${anchorIdCounter++}`

        const anchor = document.createElement("span")
        anchor.className = constants.CSS_CLASSES.ANCHOR
        if (translationType === "word") {
            anchor.classList.add("ai-translator-anchor--word")
        }
        anchor.id = anchorId
        anchor.style.cursor = "pointer"

        attachAnchorEventListeners(anchor, anchorId)

        const originalElement = range.startContainer.parentElement

        // `extractContents()` + `appendChild()` is more robust than `surroundContents()`
        // for ranges that span multiple inline elements.
        const fragment = range.extractContents()
        anchor.appendChild(fragment)
        range.insertNode(anchor)

        const tooltip = createTooltipElement()
        const styleResult = renderTooltipContent(tooltip, state, originalElement, anchor, userSettings)

        const autoAdjustHeight = userSettings?.autoAdjustHeight ?? contentIndex.getCachedUserSettings()?.autoAdjustHeight ?? true
        let didAdjustLineHeight = false
        if (autoAdjustHeight && styleResult?.spaceCalculation) {
            const adjustmentResult = lineHeightAdjuster.adjustLineHeightIfNeeded(anchor, styleResult.spaceCalculation)
            if (adjustmentResult.blockElement) {
                anchorAdjustedBlocks.set(anchorId, adjustmentResult.blockElement)
            }
            didAdjustLineHeight = adjustmentResult.didAdjustLineHeight
        }

        document.body.appendChild(tooltip)
        activeTranslations.set(anchorId, [tooltip])
        ensureOrphanObserver()
        positionTooltip(anchorId)
        if (didAdjustLineHeight) {
            // A real line-height change can push lower anchors down immediately.
            // Keep the new anchor on the fast path, then resync the rest on the next frame.
            scheduleReposition()
        }
        ensureGlobalRepositionListeners()
        setupVisibilityObserver(anchorId, anchor)

        translationDataMap.set(anchorId, {
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
            onDelete: () => removeTranslationResult(anchorId),
            onRefresh,
        })

        // Fade-in: add `visible` class after a short delay so the CSS transition plays.
        // Re-position after the transition starts to account for size changes during fade.
        setTimeout(() => {
            const segs = activeTranslations.get(anchorId) || []
            for (const seg of segs) seg.classList.add("visible")
            positionTooltip(anchorId)
        }, 10)

        logger.info("Translation displayed:", anchorId, state)
        return anchorId
    } catch (error) {
        logger.error("Error showing translation:", error)
        return "fallback-id"
    }
}

/**
 * Update the tooltip content and stored data of an existing translation annotation.
 * If the detail modal is currently showing this anchor, it is automatically refreshed.
 *
 * @param anchorId - The ID returned by `showTranslationResult`.
 * @param state - The new display state to render.
 * @param userSettings - Optional per-call overrides for font size.
 */
export function updateTranslationResult(anchorId: string, state: TranslationState, userSettings?: DisplayUserSettings): void {
    try {
        const tooltips = activeTranslations.get(anchorId)
        const tooltip = tooltips && tooltips.length > 0 ? tooltips[0] : null

        if (!tooltip) {
            logger.warn("Translation tooltip not found for ID:", anchorId)
            return
        }

        const anchor = document.getElementById(anchorId)
        const originalElement = anchor?.parentElement || null

        renderTooltipContent(tooltip, state, originalElement, anchor, userSettings)
        // Clear signature cache so the next position call re-splits text for the new content.
        anchorRectSignatureCache.delete(anchorId)
        positionTooltip(anchorId)

        const existingData = translationDataMap.get(anchorId)
        if (existingData) {
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
            translationDataMap.set(anchorId, updatedData)

            if (translationModal.getActiveModalAnchorId() === anchorId) {
                logger.info("Auto-refreshing modal for anchor:", anchorId)
                translationModal.updateTranslationModal(updatedData)
            }
        }

        logger.info("Translation updated:", anchorId, state)
    } catch (error) {
        logger.error("Error updating translation:", error)
    }
}
