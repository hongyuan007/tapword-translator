/**
 * Translation Display Management
 *
 * Handles the display of translation results with underlined text and tooltip cards.
 * Supports three states: loading, success, and error.
 */

import type { TranslationContextData, TranslationFontSizePreset } from "@/0_common/types"
import * as types from "@/0_common/types"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import * as textTruncator from "@/0_common/utils/textTruncator"
import * as constants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import type { TranslationDetailData } from "@/1_content/ui/translationModal"
import * as translationModal from "@/1_content/ui/translationModal"
import * as lineHeightAdjuster from "@/1_content/utils/lineHeightAdjuster"
import * as styleCalculator from "@/1_content/utils/styleCalculator"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("1_content/ui/translationDisplay")

const CLICK_DEBOUNCE_DELAY_MS = 250
const INTERACTION_GRACE_PERIOD_MS = 400

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Translation display state - loading
 */
interface LoadingState {
    status: "loading"
    text: string
    loadingVariant?: "text" | "spinner"
}

/**
 * Translation display state - success
 */
interface SuccessState {
    status: "success"
    translation: string
    sentenceTranslation?: string
    chineseDefinition?: string
    englishDefinition?: string
    targetDefinition?: string
    targetLanguage?: string
    lemma?: string | null
    phonetic?: string
    lemmaPhonetic?: string
}

/**
 * Translation display state - error
 */
interface ErrorState {
    status: "error"
    text: string
    errorMessage?: string
}

/**
 * Union type for all translation states
 */
type TranslationState = LoadingState | SuccessState | ErrorState

type DisplayUserSettings = {
    translationFontSizePreset?: TranslationFontSizePreset
    autoAdjustHeight?: boolean
}

function resolveMinFontSizePx(userSettings?: DisplayUserSettings): number {
    const cachedSettings = contentIndex.getCachedUserSettings()
    const resolved = translationFontSizeModule.resolveTranslationFontSize(
        userSettings?.translationFontSizePreset ?? cachedSettings?.translationFontSizePreset
    )

    return resolved.px
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Counter for generating unique anchor IDs
 */
let anchorIdCounter = 0

/**
 * Map to track active translation displays
 * Key: anchor ID, Value: tooltip segment elements appended to document.body
 *
 * Notes:
 * - For single-line selections, this array usually contains exactly one tooltip.
 * - For multi-line selections, we render multiple tooltips (one per visual line).
 */
const activeTranslations = new Map<string, HTMLElement[]>()

/**
 * Cache the last computed rect signature to avoid re-splitting text on every scroll.
 */
const anchorRectSignatureCache = new Map<string, string>()

/**
 * Cache the last computed tooltip segments for current width/rect signature.
 */
const anchorTooltipSegmentsCache = new Map<string, string[]>()

/**
 * Map to track translation data for each anchor
 * Key: anchor ID, Value: translation detail data
 */
const translationDataMap = new Map<string, TranslationDetailData>()

/**
 * Map to track adjusted block ancestor for each anchor (for orphan cleanup)
 * Key: anchor ID, Value: adjusted block element
 */
const anchorAdjustedBlocks = new Map<string, HTMLElement>()

/**
 * Map to track IntersectionObservers for each anchor (for visibility control)
 * Key: anchor ID, Value: IntersectionObserver instance
 */
const anchorObservers = new Map<string, IntersectionObserver>()

let spinnerStylesInjected = false

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Removes a translation result from the DOM and cleans up internal state.
 *
 * @param anchorId The ID of the translation anchor to remove.
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
 * Remove all translation results from the current page.
 *
 * This is primarily used for SPA navigations where host pages reuse DOM nodes
 * (e.g. YouTube next/previous video) and previously injected anchors/tooltips
 * must be fully cleaned.
 */
export function removeAllTranslationResults(): void {
    try {
        const trackedAnchorIds = Array.from(activeTranslations.keys())
        for (const anchorId of trackedAnchorIds) {
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

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Find the nearest scrollable ancestor of an element.
 * Returns null if no scrollable parent is found (meaning the main viewport is the scroller).
 *
 * @param element - The element to start searching from
 * @returns The scrollable parent element or null if none found
 */
function findScrollableParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement

    while (parent && parent.tagName !== "HTML") {
        const styles = window.getComputedStyle(parent)
        const overflowY = styles.getPropertyValue("overflow-y")
        const overflowX = styles.getPropertyValue("overflow-x")

        // Check if overflow style allows scrolling
        const isScrollableY = overflowY === "auto" || overflowY === "scroll"
        const isScrollableX = overflowX === "auto" || overflowX === "scroll"

        // Check if element is actually overflowing
        if (isScrollableY && parent.scrollHeight > parent.clientHeight) {
            return parent
        }
        if (isScrollableX && parent.scrollWidth > parent.clientWidth) {
            return parent
        }

        parent = parent.parentElement
    }

    // No scrollable parent found, viewport will be used
    return null
}

/**
 * Set up IntersectionObserver to control tooltip visibility based on anchor visibility.
 * The tooltip will be hidden when the anchor scrolls out of view in its scrollable container.
 * Only sets up observer if anchor is inside a scrollable container (not for viewport scrolling).
 *
 * @param anchorId - The unique ID of the anchor
 * @param anchor - The anchor element to observe
 * @param tooltip - The tooltip element to show/hide
 */
function setupVisibilityObserver(anchorId: string, anchor: HTMLElement): void {
    try {
        // Find the scrollable parent container
        const scrollParent = findScrollableParent(anchor)

        // Only set up observer if there's an actual scrollable container
        // If scrollParent is null (viewport), tooltip won't be clipped since it's in document.body
        if (!scrollParent) {
            logger.info(`[Visibility Observer] Skipped for anchor: ${anchorId} (no scrollable parent, using viewport)`)
            return
        }

        // Create IntersectionObserver with the scrollable parent as root
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
                threshold: 0, // Trigger as soon as even 1px enters/leaves
            }
        )

        // Start observing the anchor
        observer.observe(anchor)

        // Store observer for cleanup
        anchorObservers.set(anchorId, observer)

        logger.info(`[Visibility Observer] Set up for anchor: ${anchorId}, scrollParent: ${scrollParent.tagName}`)
    } catch (error) {
        logger.warn(`[Visibility Observer] Failed to set up for anchor: ${anchorId}`, error)
    }
}

/**
 * Cleanup and remove a translation by anchorId.
 * - Removes tooltip element
 * - Disconnects IntersectionObserver
 * - Restores line-height (via mapped block if present; else via anchorElement if provided)
 * - Optionally unwraps the anchorElement (when provided)
 * - Cleans internal maps and maybe detaches global listeners
 */
function cleanupTranslationById(anchorId: string, anchorElement?: HTMLElement | null, reason: "remove" | "orphan" = "remove"): void {
    // Remove tooltip first
    const tooltips = activeTranslations.get(anchorId)
    if (tooltips && tooltips.length > 0) {
        for (const tooltip of tooltips) {
            try {
                tooltip.remove()
            } catch {
                // ignore
            }
        }
    }

    // Disconnect and clean up IntersectionObserver
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

    // Restore line-height if it was adjusted
    const mappedBlock = anchorAdjustedBlocks.get(anchorId)
    if (mappedBlock) {
        try {
            const cachedSettings = contentIndex.getCachedUserSettings()
            const shouldRestore = cachedSettings?.restoreLineHeightOnClear ?? false
            // Always call restore to update ref counts; pass skipDomRestoration=!shouldRestore
            lineHeightAdjuster.restoreLineHeight(mappedBlock, !shouldRestore)
        } catch (e) {
            logger.warn("[translationDisplay] Failed to restore line-height via mapped block:", anchorId, e)
        } finally {
            anchorAdjustedBlocks.delete(anchorId)
        }
    }

    // Unwrap anchor if present
    if (anchorElement && anchorElement.parentNode) {
        const parent = anchorElement.parentNode
        try {
            anchorElement.replaceWith(...Array.from(anchorElement.childNodes))
            // Normalize the parent to merge adjacent text nodes
            parent.normalize()
        } catch (e) {
            logger.warn("[translationDisplay] Failed to unwrap anchor:", anchorId, e)
        }
    }

    // Clean maps
    activeTranslations.delete(anchorId)
    anchorRectSignatureCache.delete(anchorId)
    anchorTooltipSegmentsCache.delete(anchorId)
    translationDataMap.delete(anchorId)
    maybeDetachGlobalRepositionListeners()

    const tag = anchorElement ? anchorElement.tagName.toLowerCase() : "(missing)"
    if (reason === "orphan") {
        logger.warn("[translationDisplay] Orphan tooltip cleaned and state removed:", anchorId, `anchor=${tag}`)
    } else {
        logger.info("Translation removed:", anchorId)
    }
}

function removeUntrackedAnchorElements(): void {
    const anchors = Array.from(document.querySelectorAll(`.${constants.CSS_CLASSES.ANCHOR}`))
    for (const anchor of anchors) {
        if (!(anchor instanceof HTMLElement)) {
            continue
        }

        const anchorId = anchor.id
        if (anchorId && !activeTranslations.has(anchorId)) {
            unwrapAnchorElement(anchor)
            continue
        }

        if (!anchorId) {
            unwrapAnchorElement(anchor)
        }
    }
}

function removeUntrackedTooltipElements(): void {
    const trackedTooltips = new Set<HTMLElement>()
    for (const tooltips of activeTranslations.values()) {
        for (const tooltip of tooltips) {
            trackedTooltips.add(tooltip)
        }
    }

    const tooltipNodes = Array.from(document.querySelectorAll(`.${constants.CSS_CLASSES.TOOLTIP}`))
    for (const node of tooltipNodes) {
        if (!(node instanceof HTMLElement)) {
            continue
        }
        if (!trackedTooltips.has(node)) {
            node.remove()
        }
    }
}

function unwrapAnchorElement(anchorElement: HTMLElement): void {
    if (!anchorElement.parentNode) {
        return
    }

    const parent = anchorElement.parentNode
    try {
        anchorElement.replaceWith(...Array.from(anchorElement.childNodes))
        parent.normalize()
    } catch (error) {
        logger.warn("[translationDisplay] Failed to unwrap untracked anchor:", error)
    }
}

// ============================================================================
// Font Size Calculation
// ============================================================================

/**
 * Handle click on translation anchor to show detail modal
 */
function handleAnchorClick(anchorId: string): void {
    // If the modal for the clicked anchor is already open, close it.
    if (translationModal.getActiveModalAnchorId() === anchorId) {
        translationModal.closeTranslationModal()
        return
    }

    const data = translationDataMap.get(anchorId)

    if (!data) {
        logger.warn("No translation data found for anchor:", anchorId)
        return
    }

    // Get the anchor element for positioning
    const anchorElement = document.getElementById(anchorId)

    logger.info("Opening translation detail modal for:", anchorId)
    translationModal.showTranslationModal(data, anchorElement, anchorId)
}

/**
 * Attach click and double-click event listeners to the anchor
 */
function attachAnchorEventListeners(anchor: HTMLElement, anchorId: string): void {
    const creationTime = Date.now()
    // Timer for click debounce to distinguish from double-click
    let clickTimer: number | undefined

    // Add click handler to show detail modal (debounced)
    anchor.addEventListener("click", (e) => {
        e.stopPropagation()

        // Ignore single-click if the anchor was just created (e.g. from single-click translate)
        // This prevents accidental opening of modal when the user double-clicks for other reasons
        const settings = contentIndex.getCachedUserSettings()
        if (settings?.singleClickTranslate && Date.now() - creationTime < INTERACTION_GRACE_PERIOD_MS) {
            return
        }

        // If there is a pending click (rare in this context but good practice), clear it
        if (clickTimer) {
            window.clearTimeout(clickTimer)
        }

        // Delay modal opening to allow double-click to intercept
        clickTimer = window.setTimeout(() => {
            handleAnchorClick(anchorId)
            clickTimer = undefined
        }, CLICK_DEBOUNCE_DELAY_MS)
    })

    // Add double-click handler to close translation
    anchor.addEventListener("dblclick", (e) => {
        e.stopPropagation()
        e.preventDefault()

        // Ignore double-click if the anchor was just created (e.g. from single-click translate)
        // This prevents accidental closure when the user double-clicks for other reasons
        // or when single-click translate is enabled and the second click hits the new anchor
        const settings = contentIndex.getCachedUserSettings()
        if (settings?.singleClickTranslate && Date.now() - creationTime < INTERACTION_GRACE_PERIOD_MS) {
            return
        }

        // Cancel any pending single-click action (modal open)
        if (clickTimer) {
            window.clearTimeout(clickTimer)
            clickTimer = undefined
        }

        // Close modal if it's open for this anchor
        if (translationModal.getActiveModalAnchorId() === anchorId) {
            translationModal.closeTranslationModal()
        }

        logger.info("Double-click on anchor, removing:", anchorId)
        removeTranslationResult(anchorId)
        window.getSelection()?.removeAllRanges()
    })
}

// ============================================================================
// Tooltip Positioning (Portal to <body>)
// ============================================================================

/**
 * Ensure global scroll/resize listeners are attached exactly once
 */
let globalRepositionAttached = false
let repositionScheduled = false

function ensureGlobalRepositionListeners(): void {
    if (globalRepositionAttached) return
    const scheduleReposition = () => {
        if (repositionScheduled) return
        repositionScheduled = true
        requestAnimationFrame(() => {
            repositionScheduled = false
            // Reposition all active tooltips
            // Snapshot keys to avoid iterator issues if a tooltip is removed during iteration
            const ids = Array.from(activeTranslations.keys())
            for (const anchorId of ids) {
                positionTooltip(anchorId)
            }
        })
    }
    window.addEventListener("scroll", scheduleReposition, { passive: true, capture: true })
    window.addEventListener("resize", scheduleReposition)
    globalRepositionAttached = true
}

function maybeDetachGlobalRepositionListeners(): void {
    if (globalRepositionAttached && activeTranslations.size === 0) {
        // For simplicity, reload-safe approach: replace listeners by toggling a flag; in content scripts,
        // removing anonymous listeners is tricky; instead keep them but they do nothing when map is empty.
        // If strict cleanup is required, refactor to keep bound references.
        globalRepositionAttached = false
    }
}

// ============================================================================
// Multi-line (Multi-Rect) Helpers
// ============================================================================

const LINE_GROUP_EPSILON_PX = 2
const VIEWPORT_PAD_PX = 8
const RECT_SIGNATURE_ROUND_PX = 1

function getNormalizedLineRects(anchor: HTMLElement): DOMRect[] {
    const rects = Array.from(anchor.getClientRects())
        .filter((r) => r && r.width > 0 && r.height > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left)

    type LineAccumulator = { top: number; bottom: number; left: number; right: number }
    const lines: LineAccumulator[] = []

    for (const r of rects) {
        const existing = lines.find((l) => Math.abs(l.top - r.top) <= LINE_GROUP_EPSILON_PX)
        if (!existing) {
            lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
            continue
        }

        existing.top = Math.min(existing.top, r.top)
        existing.bottom = Math.max(existing.bottom, r.bottom)
        existing.left = Math.min(existing.left, r.left)
        existing.right = Math.max(existing.right, r.right)
    }

    return lines.map((l) => new DOMRect(l.left, l.top, Math.max(0, l.right - l.left), Math.max(0, l.bottom - l.top)))
}

function buildRectsSignature(rects: DOMRect[]): string {
    // Signature changes when line breaks / widths / positions change.
    return rects
        .map((r) => {
            const left = Math.round((r.left || 0) / RECT_SIGNATURE_ROUND_PX)
            const top = Math.round((r.top || 0) / RECT_SIGNATURE_ROUND_PX)
            const width = Math.round((r.width || 0) / RECT_SIGNATURE_ROUND_PX)
            return `${left},${top},${width}`
        })
        .join("|")
}

function createTooltipElement(): HTMLElement {
    const tooltip = document.createElement("div")
    tooltip.className = constants.CSS_CLASSES.TOOLTIP
    return tooltip
}

function syncTooltipStyles(source: HTMLElement, target: HTMLElement): void {
    target.style.fontSize = source.style.fontSize
    target.style.color = source.style.color
    target.style.fontFamily = source.style.fontFamily
    target.style.fontWeight = source.style.fontWeight
}

function ensureTooltipSegmentCount(anchorId: string, count: number, baseTooltip?: HTMLElement): HTMLElement[] {
    const existing = activeTranslations.get(anchorId) || []

    if (existing.length === count) {
        return existing
    }

    // Remove extra
    if (existing.length > count) {
        for (let i = count; i < existing.length; i++) {
            try {
                existing[i]?.remove()
            } catch {
                // ignore
            }
        }
        const trimmed = existing.slice(0, count)
        activeTranslations.set(anchorId, trimmed)
        return trimmed
    }

    // Add missing
    const next: HTMLElement[] = existing.slice()
    for (let i = existing.length; i < count; i++) {
        const tooltip = createTooltipElement()
        if (baseTooltip) {
            syncTooltipStyles(baseTooltip, tooltip)

            // Keep the same state/visibility as the base tooltip.
            // This is critical on responsive reflow: new segments created after the initial fade-in
            // must inherit `.visible`, otherwise they stay hidden.
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

/**
 * Check if the tooltip content overflows its container and apply/remove the truncation class.
 */
function checkTruncation(element: HTMLElement, bufferPx: number = 1): void {
    if (element.scrollWidth > element.clientWidth + bufferPx) {
        element.classList.add("is-truncated")
    } else {
        element.classList.remove("is-truncated")
    }
}

function setTooltipText(tooltip: HTMLElement, rawText: string, _maxWidthPx: number, _isLastLine: boolean): void {
    // Spinner variant: do not split; keep existing spinner UI in the first tooltip only.
    if (tooltip.dataset.loadingVariant === "spinner") {
        return
    }

    // New logic: Do not truncate with "...", allow CSS mask to handle overflow.
    // If it's the last line (or single line), we give it the full remaining text.
    // We still limit it slightly to avoid extreme DOM size if something goes wrong, but generous.
    const textToSet = rawText.length > 200 ? rawText.slice(0, 200) : rawText
    tooltip.textContent = textToSet

    // Check for truncation after layout update
    requestAnimationFrame(() => {
        checkTruncation(tooltip)
    })
}

function splitTextAcrossRects(fullText: string, rectWidths: number[], elementForFont: HTMLElement): string[] {
    const font = textTruncator.getFontShorthandFromElement(elementForFont)
    const segments: string[] = []

    let remaining = fullText
    for (let i = 0; i < rectWidths.length; i++) {
        const width = rectWidths[i] || 0
        const isLast = i === rectWidths.length - 1

        if (!remaining) break

        if (isLast) {
            // For the last line, take the rest of the text.
            // CSS fade-out will handle the overflow if it's too long.
            segments.push(remaining)
            continue
        }

        const prefix = longestPrefixThatFits(remaining, width, font)
        segments.push(prefix)
        remaining = remaining.slice(prefix.length).trimStart()
    }

    return segments
}

function longestPrefixThatFits(text: string, maxWidthPx: number, font: string): string {
    if (maxWidthPx <= 0 || !text) return ""

    // Fast path: whole text fits
    if (textTruncator.measureTextWidth(text, font) <= maxWidthPx) {
        return text
    }

    let lo = 0
    let hi = text.length
    let best = 0

    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const candidate = text.slice(0, mid)
        const w = textTruncator.measureTextWidth(candidate, font)
        if (w <= maxWidthPx) {
            best = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }

    // Prefer to not split in the middle of a word for space-delimited languages.
    // If there is a whitespace boundary close to best, snap back.
    const raw = text.slice(0, best)
    const lastSpace = Math.max(raw.lastIndexOf(" "), raw.lastIndexOf("\n"), raw.lastIndexOf("\t"))
    if (lastSpace >= 8) {
        const snapped = raw.slice(0, lastSpace)
        // Ensure snapped isn't too small; otherwise keep raw
        if (textTruncator.measureTextWidth(snapped, font) <= maxWidthPx * 0.98) {
            return snapped
        }
    }

    return raw
}

/**
 * Position the tooltip (in document.body) relative to the last client rect of the anchor
 */
function positionTooltip(anchorId: string): void {
    const tooltips = activeTranslations.get(anchorId)
    if (!tooltips || tooltips.length === 0) return
    const anchor = document.getElementById(anchorId)
    if (!anchor) {
        // Anchor has been removed by the host page (e.g., Reddit virtualization/route changes)
        // Use common cleanup path with orphan reason (cannot unwrap missing anchor)
        cleanupTranslationById(anchorId, null, "orphan")
        return
    }

    const rects = getNormalizedLineRects(anchor)
    const lineRects = rects.length > 0 ? rects : [anchor.getBoundingClientRect()]
    if (lineRects.length === 0) return

    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0
    const viewportWidth = document.documentElement.clientWidth

    const signature = buildRectsSignature(lineRects)
    const lastSignature = anchorRectSignatureCache.get(anchorId)

    const baseTooltip = tooltips[0]
    const firstTooltip = baseTooltip
    if (!firstTooltip) {
        return
    }

    const isSpinner = firstTooltip.dataset.loadingVariant === "spinner"

    // Recompute text split only when signature changes.
    if (signature !== lastSignature) {
        anchorRectSignatureCache.set(anchorId, signature)

        if (isSpinner) {
            anchorTooltipSegmentsCache.set(anchorId, [])
        } else {
            const raw = firstTooltip.dataset.sourceText || firstTooltip.dataset.fullText || firstTooltip.textContent || ""
            const widths = lineRects.map((r) => r.width)
            const split = splitTextAcrossRects(raw, widths, firstTooltip)
            anchorTooltipSegmentsCache.set(anchorId, split)
        }
    }

    const cached = anchorTooltipSegmentsCache.get(anchorId) || []
    const desiredCount = isSpinner ? 1 : Math.max(1, cached.length)
    const segments = ensureTooltipSegmentCount(anchorId, desiredCount, firstTooltip)

    const isSingleLine = segments.length === 1

    const segs = activeTranslations.get(anchorId) || []
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
            const text = cached[i] ?? ""
            setTooltipText(tooltip, text, rectWidth, isLastLine)
        }

        const cachedSettings = contentIndex.getCachedUserSettings()
        const verticalOffset = cachedSettings?.tooltipVerticalOffsetPxV2 ?? types.DEFAULT_USER_SETTINGS.tooltipVerticalOffsetPxV2
        const top = rect.bottom + scrollY + verticalOffset

        const tooltipWidth = tooltip.offsetWidth || 0
        let left: number
        if (isSingleLine) {
            const idealLeft = rect.left + scrollX + (rect.width - tooltipWidth) / 2
            left = Math.max(scrollX + VIEWPORT_PAD_PX, Math.min(idealLeft, scrollX + viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        } else {
            // Left-align to the rect for multi-line layout
            left = rect.left + scrollX
            left = Math.max(scrollX + VIEWPORT_PAD_PX, Math.min(left, scrollX + viewportWidth - tooltipWidth - VIEWPORT_PAD_PX))
        }

        tooltip.style.top = `${top}px`
        tooltip.style.left = `${left}px`
    }
}

function ensureSpinnerStyles(): void {
    if (spinnerStylesInjected) return
    const style = document.createElement("style")
    style.id = "ai-translator-spinner-styles"
    style.textContent = `
.ai-translator-spinner { width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.25); border-top-color: currentColor; border-radius: 50%; animation: ai-translator-spin 0.8s linear infinite; margin: 0 auto; box-sizing: border-box; }
.ai-translator-spinner-hidden-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
@keyframes ai-translator-spin { to { transform: rotate(360deg); } }
`
    document.head?.appendChild(style)
    spinnerStylesInjected = true
}

// ============================================================================
// Main Display Functions
// ============================================================================

/**
 * Show translation result below the selected text
 *
 * @param range - The Range object containing the selected text
 * @param selectedText - The selected text to translate
 * @param state - The translation state (loading, success, or error)
 * @param context - The translation context data containing originalSentence and other contextual information
 * @param onRefresh - Optional callback function to handle refresh/retranslation
 * @param translationType - The type of translation: 'word' or 'fragment' (defaults to 'word')
 * @returns The unique ID of the created anchor element
 *
 * @example
 * ```typescript
 * // Show loading state for word translation
 * const id = showTranslationResult(range, 'light', { status: 'loading', text: translate('modal.loading') }, context, undefined, 'word');
 *
 * // Show loading state for fragment translation
 * const id = showTranslationResult(range, 'of a successful', { status: 'loading', text: translate('modal.loading') }, context, undefined, 'fragment');
 *
 * // Later update with success
 * updateTranslationResult(id, {
 *     status: 'success',
 *     translation: '光线',
 *     sentenceTranslation: '房间里充满了自然光线。'
 * });
 * ```
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
        // Generate unique anchor ID
        const anchorId = `translation-anchor-${anchorIdCounter++}`

        // Create anchor element to wrap the selected text
        const anchor = document.createElement("span")
        anchor.className = constants.CSS_CLASSES.ANCHOR
        if (translationType === "word") {
            anchor.classList.add("ai-translator-anchor--word")
        }
        anchor.id = anchorId
        anchor.style.cursor = "pointer" // Make it clear it's clickable

        // Attach event listeners for click (modal) and double-click (close)
        attachAnchorEventListeners(anchor, anchorId)

        // Get the computed font size of the original text before wrapping
        const originalElement = range.startContainer.parentElement

        // Wrap the selected content using extractContents() + appendChild()
        // This is more robust than surroundContents() for ranges that cross element boundaries
        const fragment = range.extractContents()
        anchor.appendChild(fragment)
        range.insertNode(anchor)

        // Create the first tooltip segment (portal to body)
        const tooltip = createTooltipElement()

        // Set tooltip content based on state and get space calculation (first segment stores fullText)
        const styleResult = renderTooltipContent(tooltip, state, originalElement, anchor, userSettings)

        // Apply dynamic line-height adjustment if enabled and needed
        // Check user setting for auto-adjust height
        const autoAdjustHeight = userSettings?.autoAdjustHeight ?? contentIndex.getCachedUserSettings()?.autoAdjustHeight ?? true // Default to true if settings not loaded
        if (autoAdjustHeight && styleResult?.spaceCalculation) {
            const adjustedBlock = lineHeightAdjuster.adjustLineHeightIfNeeded(anchor, styleResult.spaceCalculation)
            if (adjustedBlock) {
                anchorAdjustedBlocks.set(anchorId, adjustedBlock)
            }
        }

        // Append tooltip to document body (portal) and track as the first segment
        document.body.appendChild(tooltip)
        activeTranslations.set(anchorId, [tooltip])
        // Initial positioning after content is set
        positionTooltip(anchorId)
        ensureGlobalRepositionListeners()

        // Set up IntersectionObserver to hide tooltip(s) when anchor scrolls out of view
        setupVisibilityObserver(anchorId, anchor)

        // Store initial translation data
        const initialData: TranslationDetailData = {
            status: state.status,
            translationType: translationType,
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
            // If caller already knows the source language (e.g., performed detection earlier), propagate it now.
            sourceLanguage: context?.sourceLanguage,
            onDelete: () => removeTranslationResult(anchorId),
            onRefresh: onRefresh,
        }
        translationDataMap.set(anchorId, initialData)

        // Trigger fade-in animation
        setTimeout(() => {
            const segs = activeTranslations.get(anchorId) || []
            for (const seg of segs) {
                seg.classList.add("visible")
            }
            // Reposition once visible to account for potential size change due to transitions
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
 * Update an existing translation result
 *
 * @param anchorId - The unique ID of the anchor element
 * @param state - The new translation state
 *
 * @example
 * ```typescript
 * // Update with success state
 * updateTranslationResult('translation-anchor-0', {
 *     status: 'success',
 *     translation: '光线'
 * });
 *
 * // Update with error state
 * updateTranslationResult('translation-anchor-0', {
 *     status: 'error',
 *     text: '翻译失败'
 * });
 * ```
 */
export function updateTranslationResult(anchorId: string, state: TranslationState, userSettings?: DisplayUserSettings): void {
    try {
        const tooltips = activeTranslations.get(anchorId)
        const tooltip = tooltips && tooltips.length > 0 ? tooltips[0] : null

        if (!tooltip) {
            logger.warn("Translation tooltip not found for ID:", anchorId)
            return
        }

        // Get original element for font size calculation
        const anchor = document.getElementById(anchorId)
        const originalElement = anchor?.parentElement || null

        // Update first tooltip content (stores fullText); other segments will be derived in positionTooltip()
        renderTooltipContent(tooltip, state, originalElement, anchor, userSettings)
        // Clear cached signature so that we re-split on next position.
        anchorRectSignatureCache.delete(anchorId)
        // Reposition after content update (also reapplies width constraint and fade)
        positionTooltip(anchorId)

        // Update stored translation data
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
                // Preserve leadingText, trailingText, onDelete, and onRefresh from existing data
                leadingText: existingData.leadingText,
                trailingText: existingData.trailingText,
                onDelete: existingData.onDelete,
                onRefresh: existingData.onRefresh,
            }
            translationDataMap.set(anchorId, updatedData)

            // If modal is open for this anchor, automatically update it
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

// ============================================================================
// Rendering Functions
// ============================================================================

/**
 * Render tooltip content based on translation state
 * Returns the style result including space calculation for line-height adjustment
 */
function renderTooltipContent(
    tooltip: HTMLElement,
    state: TranslationState,
    originalElement: HTMLElement | null,
    anchor?: HTMLElement | null,
    userSettings?: DisplayUserSettings
): styleCalculator.TooltipStyle {
    // Clear existing content
    tooltip.innerHTML = ""

    // Get user-configured minimum font size for translation (preset-aware)
    const minFontSize = resolveMinFontSizePx(userSettings)

    // Calculate and apply dynamic styles
    const style = styleCalculator.calculateTooltipStyle(originalElement, anchor, 16, minFontSize)
    tooltip.style.fontSize = `${style.fontSize}px`

    // Only set color for non-error states
    // For error state, use CSS class color (#FF6B35)
    if (state.status !== "error") {
        tooltip.style.color = style.color
    } else {
        // Clear inline color to let CSS .error class take effect
        tooltip.style.color = ""
    }

    // Render based on state
    if (state.status === "loading") {
        tooltip.classList.add("loading")
        tooltip.classList.remove("error")

        if (state.loadingVariant === "spinner") {
            tooltip.dataset.loadingVariant = "spinner"
            tooltip.dataset.sourceText = state.text
            ensureSpinnerStyles()
            tooltip.dataset.fullText = ""
            tooltip.textContent = ""

            const wrapper = document.createElement("div")
            wrapper.style.display = "flex"
            wrapper.style.justifyContent = "center"
            wrapper.style.alignItems = "center"
            wrapper.style.gap = "6px"

            const spinner = document.createElement("div")
            spinner.className = "ai-translator-spinner"
            spinner.style.color = style.color

            const hiddenText = document.createElement("span")
            hiddenText.className = "ai-translator-spinner-hidden-text"
            hiddenText.textContent = state.text
            spinner.appendChild(hiddenText)

            wrapper.appendChild(spinner)
            tooltip.appendChild(wrapper)
        } else {
            delete tooltip.dataset.loadingVariant
            tooltip.dataset.sourceText = state.text
            tooltip.dataset.fullText = state.text
            tooltip.textContent = state.text
        }
    } else if (state.status === "error") {
        delete tooltip.dataset.loadingVariant
        tooltip.dataset.sourceText = state.text
        tooltip.dataset.fullText = state.text
        tooltip.textContent = state.text
        tooltip.classList.add("error")
        tooltip.classList.remove("loading")
    } else if (state.status === "success") {
        delete tooltip.dataset.loadingVariant
        // Show word translation (required)
        tooltip.dataset.sourceText = state.translation
        tooltip.dataset.fullText = state.translation
        tooltip.textContent = state.translation
        tooltip.classList.remove("loading", "error")

        // // Optionally show sentence translation if available
        // if (state.sentenceTranslation) {
        //     const sentenceDiv = document.createElement('div');
        //     sentenceDiv.className = 'sentence-translation';
        //     sentenceDiv.textContent = state.sentenceTranslation;
        //     sentenceDiv.style.marginTop = '4px';
        //     sentenceDiv.style.paddingTop = '4px';
        //     sentenceDiv.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
        //     sentenceDiv.style.fontSize = `${translationFontSize * 0.9}px`;
        //     sentenceDiv.style.opacity = '0.9';
        //     tooltip.appendChild(sentenceDiv);
        // }
    }

    return style
}
