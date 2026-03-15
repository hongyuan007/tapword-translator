/**
 * @file hitTesting.ts
 * Global click/dblclick handler using rect-based hit testing.
 *
 * Replaces V1's per-anchor event listeners with a single pair of document-level listeners.
 * Determines which translation (if any) was clicked by testing the click point against
 * all active Range bounding rects via `Range.getClientRects()`.
 *
 * - Single click (debounced): opens detail modal
 * - Double click: removes the translation
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as editableElementDetector from "@/1_content/handlers/utils/editableElementDetector"
import { CLICK_DEBOUNCE_DELAY_MS, INTERACTION_GRACE_PERIOD_MS, RANGE_HIT_TEST_HORIZONTAL_PAD_PX } from "./types"
import { getNormalizedLineRects } from "./tooltipLayout"
import { isRectVisibleForSource } from "./clipVisibility"

const logger = loggerModule.createLogger("translationDisplayV2/hitTesting")

// ============================================================================
// Types
// ============================================================================

/** Callback interface provided by the coordinator to decouple hit testing from state. */
type HitTestCallbacks = {
    /** Returns a snapshot of all active translation ranges, tooltips, and creation times. */
    getActiveTranslations: () => Map<string, { range: Range; tooltips: HTMLElement[]; creationTime: number }>
    /** Called when a single click lands on a translation range. */
    onTranslationClick: (id: string) => void
    /** Called when a double click lands on a translation range. */
    onTranslationDblClick: (id: string) => void
    /** Whether single-click-translate mode is enabled (affects grace period). */
    isSingleClickTranslateEnabled: () => boolean
}

// ============================================================================
// Module State
// ============================================================================

let callbacks: HitTestCallbacks | null = null
let clickTimer: number | undefined
let attached = false

/** Capture-phase options so our listeners fire before page handlers. */
const CAPTURE_OPTIONS: AddEventListenerOptions = { capture: true }

// CSS selectors for our own UI elements — clicks on these should be ignored
const OWN_UI_SELECTOR = ".ai-translator-tooltip, .ai-translator-icon, .ai-translator-modal, .ai-translator-modal-backdrop"

// ============================================================================
// Public API
// ============================================================================

/** Attach global click/dblclick listeners. Idempotent — subsequent calls update callbacks only. */
export function attachGlobalHitListeners(cb: HitTestCallbacks): void {
    callbacks = cb
    if (attached) return

    document.addEventListener("click", handleClick, CAPTURE_OPTIONS)
    document.addEventListener("dblclick", handleDblClick, CAPTURE_OPTIONS)
    attached = true
    logger.info("Global hit-test listeners attached")
}

/** Detach global listeners. Safe to call even if not attached. */
export function detachGlobalHitListeners(): void {
    if (!attached) return

    document.removeEventListener("click", handleClick, CAPTURE_OPTIONS)
    document.removeEventListener("dblclick", handleDblClick, CAPTURE_OPTIONS)
    attached = false
    callbacks = null

    if (clickTimer) {
        window.clearTimeout(clickTimer)
        clickTimer = undefined
    }
    logger.info("Global hit-test listeners detached")
}

export function cancelPendingTranslationClick(): void {
    if (!clickTimer) return

    window.clearTimeout(clickTimer)
    clickTimer = undefined
}

export function isPointInsideAnyActiveTranslation(x: number, y: number): boolean {
    if (!callbacks) return false

    for (const entry of callbacks.getActiveTranslations().values()) {
        if (isPointInsideTranslationZone(x, y, entry.range, entry.tooltips)) {
            return true
        }
    }

    return false
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleClick(e: MouseEvent): void {
    if (!callbacks) return

    // Skip clicks on our own UI elements
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest(OWN_UI_SELECTOR)) return

    const interaction = editableElementDetector.classifyInteractiveElement(target, e)
    if (interaction.isInteractive && interaction.level === "strong") {
        logger.debug("Skipping translation click on strong interactive element", {
            tag: interaction.element?.tagName,
            reason: interaction.reason,
        })
        return
    }

    // Skip if user just finished a drag-selection — not an intentional click on a translation
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return

    const matchedId = findHitTranslationByPoint(e.clientX, e.clientY)
    if (!matchedId) return

    // Grace period: ignore clicks shortly after creation in single-click-translate mode
    const entry = callbacks.getActiveTranslations().get(matchedId)
    if (entry && callbacks.isSingleClickTranslateEnabled() && Date.now() - entry.creationTime < INTERACTION_GRACE_PERIOD_MS) {
        return
    }

    const shouldStopPropagation = interaction.level !== "weak" && !interaction.ignoredAsTextException
    if (shouldStopPropagation) {
        e.stopPropagation()
    }

    if (clickTimer) window.clearTimeout(clickTimer)
    clickTimer = window.setTimeout(() => {
        callbacks?.onTranslationClick(matchedId)
        clickTimer = undefined
    }, CLICK_DEBOUNCE_DELAY_MS)
}

function handleDblClick(e: MouseEvent): void {
    if (!callbacks) return

    // Skip clicks on our own UI elements
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest(OWN_UI_SELECTOR)) return

    const interaction = editableElementDetector.classifyInteractiveElement(target, e)
    if (interaction.isInteractive && interaction.level === "strong") {
        logger.debug("Skipping translation double-click on strong interactive element", {
            tag: interaction.element?.tagName,
            reason: interaction.reason,
        })
        return
    }

    // Note: no selection.isCollapsed guard here — double-clicking inherently selects the word,
    // so getSelection() is always non-collapsed. The drag-select guard is only in handleClick.

    const matchedId = findHitTranslationByPoint(e.clientX, e.clientY)
    if (!matchedId) return

    // Grace period: ignore clicks shortly after creation in single-click-translate mode
    const entry = callbacks.getActiveTranslations().get(matchedId)
    if (entry && callbacks.isSingleClickTranslateEnabled() && Date.now() - entry.creationTime < INTERACTION_GRACE_PERIOD_MS) {
        return
    }

    const shouldStopPropagation = interaction.level !== "weak" && !interaction.ignoredAsTextException
    if (shouldStopPropagation) {
        e.stopPropagation()
    }
    e.preventDefault()

    // Cancel any pending single-click action
    if (clickTimer) {
        window.clearTimeout(clickTimer)
        clickTimer = undefined
    }

    callbacks.onTranslationDblClick(matchedId)
}

// ============================================================================
// Hit-Test Core
// ============================================================================

/**
 * Find which active translation range (if any) contains the given screen point.
 * Uses rect-based hit testing via `Range.getClientRects()` plus tooltip rects and gap bridging.
 *
 * @param x - clientX of the click point.
 * @param y - clientY of the click point.
 * @returns The translation ID, or `null` if no match.
 */
function findHitTranslationByPoint(x: number, y: number): string | null {
    if (!callbacks) return null
    for (const [id, entry] of callbacks.getActiveTranslations()) {
        if (isPointInsideTranslationZone(x, y, entry.range, entry.tooltips)) return id
    }
    return null
}

/**
 * Check if a screen point falls inside a translation's complete visual zone:
 *   1. Range text rects (the original characters, with horizontal padding)
 *   2. Tooltip element rects (the translation display below)
 *   3. The vertical gap between Range bottom and tooltip top
 */
export function isPointInsideTranslationZone(
    x: number, y: number, range: Range, tooltips: HTMLElement[]
): boolean {
    const rangeRects = getNormalizedLineRects(range)
    const sourceElement = range.startContainer.parentElement

    // 1. Range text rects (with horizontal padding)
    for (const rect of rangeRects) {
        if (!isRectVisibleForSource(rect, sourceElement, range)) continue
        if (
            x >= rect.left - RANGE_HIT_TEST_HORIZONTAL_PAD_PX &&
            x <= rect.right + RANGE_HIT_TEST_HORIZONTAL_PAD_PX &&
            y >= rect.top &&
            y <= rect.bottom
        ) {
            return true
        }
    }

    // 2. Tooltip element rects
    for (const tooltip of tooltips) {
        if (tooltip.style.visibility === "hidden") continue
        const rect = tooltip.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return true
        }
    }

    // 3. Bridge the vertical gap between each source line and its corresponding tooltip.
    // Avoid cross-combining every rect with every tooltip; that can create oversized
    // hit zones extending into nearby, untranslated text.
    for (let i = 0; i < rangeRects.length; i++) {
        const rangeRect = rangeRects[i]
        if (!rangeRect) continue
        if (rangeRect.width === 0 || rangeRect.height === 0) continue
        if (!isRectVisibleForSource(rangeRect, sourceElement, range)) continue
        const tooltip = tooltips[i]
        if (!tooltip) continue
        if (tooltip.style.visibility === "hidden") continue

        const tooltipRect = tooltip.getBoundingClientRect()
        if (tooltipRect.width === 0 || tooltipRect.height === 0) continue

        const gapTop = rangeRect.bottom
        const gapBottom = tooltipRect.top
        if (gapBottom <= gapTop) continue
        if (y >= gapTop && y <= gapBottom) {
            const hLeft = Math.min(rangeRect.left, tooltipRect.left) - RANGE_HIT_TEST_HORIZONTAL_PAD_PX
            const hRight = Math.max(rangeRect.right, tooltipRect.right) + RANGE_HIT_TEST_HORIZONTAL_PAD_PX
            if (x >= hLeft && x <= hRight) return true
        }
    }

    return false
}

/**
 * Check whether a given caret position falls within a Range.
 * Creates a collapsed Range at the point and compares boundary positions.
 *
 * @param range - The translation Range to test against.
 * @param node - The node at the caret position.
 * @param offset - The offset within the node.
 * @returns `true` if the position is inside the range.
 */
export function rangeContainsPosition(range: Range, node: Node, offset: number): boolean {
    try {
        const point = document.createRange()
        point.setStart(node, offset)
        point.collapse(true)

        // point >= range.start AND point <= range.end
        return (
            range.compareBoundaryPoints(Range.START_TO_START, point) <= 0 &&
            range.compareBoundaryPoints(Range.END_TO_START, point) >= 0
        )
    } catch {
        // compareBoundaryPoints throws if ranges are in different documents or detached
        return false
    }
}
