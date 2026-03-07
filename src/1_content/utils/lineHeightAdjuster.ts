/**
 * Line Height Adjuster
 *
 * Dynamically adjusts the line-height of text blocks when available space
 * is insufficient for displaying translation tooltips.
 *
 * This ensures translation tooltips have adequate space without overlapping
 * with surrounding content, similar to bilingual subtitle layouts.
 *
 * **Reference Counting:**
 * Multiple translations within the same block element share the adjusted line-height.
 * The module uses reference counting to track how many anchors are using each
 * adjusted block. The original line-height is only restored when the last
 * anchor is removed.
 */

import * as types from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as contentConstants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"

const logger = loggerModule.createLogger("lineHeightAdjuster")

// Store original line-heights to allow restoration if needed
const originalLineHeights = new WeakMap<HTMLElement, string>()

// Reference counting: track how many anchors are using each adjusted block element
const blockElementRefCount = new WeakMap<HTMLElement, number>()

// Marker attribute to track adjusted elements
const ADJUSTED_MARKER = "data-ai-translator-line-height-adjusted"

/**
 * Space calculation details returned from styleCalculator
 */
export interface SpaceCalculation {
    originalFontSize: number
    lineHeight: number
    lineSpacing: number
    availableSpace: number
    requiredFontSize: number
    minFontSize: number
    maxFontSize: number
}

/**
 * Find the nearest block-level ancestor element.
 * Block-level elements are those that typically create new layout blocks.
 *
 * Checks the element itself first: if it is already block-level, returns it.
 * Otherwise walks up to parentElement, then grandparent, etc.
 *
 * This self-check is safe for V1 callers (anchor span is inline → skipped, walks to parent block)
 * and necessary for V2 callers (startContainer.parentElement may already be `<p>`/`<div>`).
 *
 * @param element - The starting element (anchor span in V1, or text node parent in V2)
 * @returns The nearest block-level element (may be `element` itself), or `document.body` as fallback
 */
export function findNearestBlockAncestor(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null

    let current: HTMLElement | null = element

    while (current) {
        const display = window.getComputedStyle(current).display

        // Check for block-level display types
        if (
            display === "block" ||
            display === "flex" ||
            display === "grid" ||
            display === "table" ||
            display === "list-item" ||
            display === "flow-root"
        ) {
            logger.info(`Found block ancestor: <${current.tagName.toLowerCase()}> with display: ${display}`)
            return current
        }

        current = current.parentElement
    }

    logger.warn("No block ancestor found, returning document.body")
    return document.body
}

/**
 * Calculate the required line-height increase to accommodate the translation tooltip.
 *
 * @param spaceCalc - Space calculation details from styleCalculator
 * @returns The required line-height increase in pixels, or 0 if no adjustment needed
 */
export function calculateRequiredLineHeightIncrease(spaceCalc: SpaceCalculation): number {
    const { availableSpace, minFontSize } = spaceCalc
    const cachedSettings = contentIndex.getCachedUserSettings()
    const desiredGap = cachedSettings?.tooltipNextLineGapPxV2 ?? types.DEFAULT_USER_SETTINGS.tooltipNextLineGapPxV2

    // Target: make available space just above the minimum font size by a small safety delta
    const safetyDelta = contentConstants.MIN_TOOLTIP_SAFETY_DELTA_PX
    const targetAvailableSpace = Math.max(minFontSize + safetyDelta + desiredGap, 0)

    if (availableSpace >= targetAvailableSpace) {
        logger.info(`Available space (${availableSpace.toFixed(2)}px) already >= target (${targetAvailableSpace.toFixed(2)}px), no adjustment needed`)
        return 0
    }

    const increase = targetAvailableSpace - availableSpace
    logger.info(
        `Line-height increase needed: ${increase.toFixed(2)}px (targetAvailable=${targetAvailableSpace.toFixed(2)}px, available=${availableSpace.toFixed(2)}px)`
    )
    return increase
}

/**
 * Apply line-height adjustment to the specified block element.
 * Uses reference counting to track multiple anchors in the same block.
 *
 * @param blockElement - The block element to adjust
 * @param increase - The line-height increase in pixels
 */
export function applyLineHeightAdjustment(blockElement: HTMLElement, increase: number): void {
    if (increase <= 0) {
        logger.info("No line-height adjustment applied (increase <= 0)")
        return
    }

    // Check if already adjusted
    const isAlreadyAdjusted = blockElement.hasAttribute(ADJUSTED_MARKER)

    if (isAlreadyAdjusted) {
        // Increment reference count
        const currentCount = blockElementRefCount.get(blockElement) || 0
        blockElementRefCount.set(blockElement, currentCount + 1)
        logger.info(`Block element already adjusted, incrementing ref count to ${currentCount + 1}`)
        return
    }

    // Store original line-height
    const computedStyle = window.getComputedStyle(blockElement)
    const originalLineHeight = computedStyle.lineHeight

    if (!originalLineHeights.has(blockElement)) {
        originalLineHeights.set(blockElement, originalLineHeight)
        logger.info(`Stored original line-height: ${originalLineHeight}`)
    }

    // Calculate new line-height
    let currentLineHeight: number
    if (originalLineHeight === "normal") {
        // Assume normal is 1.2 times font size
        const fontSize = parseFloat(computedStyle.fontSize)
        currentLineHeight = fontSize * 1.2
    } else {
        currentLineHeight = parseFloat(originalLineHeight)
    }

    const newLineHeight = currentLineHeight + increase

    // Apply new line-height
    blockElement.style.lineHeight = `${newLineHeight}px`
    blockElement.setAttribute(ADJUSTED_MARKER, "true")

    // Initialize reference count to 1
    blockElementRefCount.set(blockElement, 1)

    logger.info(
        `Line-height adjusted: ${currentLineHeight.toFixed(2)}px → ${newLineHeight.toFixed(2)}px ` +
            `(increase: ${increase.toFixed(2)}px) on <${blockElement.tagName.toLowerCase()}>, ref count: 1`
    )
}

/**
 * Restore the original line-height of an adjusted element.
 * Uses reference counting to only restore when no anchors are using it.
 *
 * @param blockElement - The block element to restore
 * @param skipDomRestoration - If true, decrements ref count but keeps DOM adjustment even at 0 refs
 */
export function restoreLineHeight(blockElement: HTMLElement, skipDomRestoration: boolean = false): void {
    if (!blockElement.hasAttribute(ADJUSTED_MARKER)) {
        return
    }

    // Decrement reference count
    const currentCount = blockElementRefCount.get(blockElement) || 1
    const newCount = Math.max(0, currentCount - 1)

    // Update ref count regardless
    blockElementRefCount.set(blockElement, newCount)

    if (newCount > 0) {
        // Still have other anchors using this block element
        logger.info(`Decremented ref count to ${newCount}, keeping line-height adjustment on <${blockElement.tagName.toLowerCase()}>`)
        return
    }

    if (skipDomRestoration) {
        logger.info(`Ref count reached 0 but skipDomRestoration is true. Keeping line-height adjustment on <${blockElement.tagName.toLowerCase()}>`)
        return
    }

    // No more references, safe to restore
    const original = originalLineHeights.get(blockElement)
    if (original) {
        blockElement.style.lineHeight = original
        logger.info(`Restored original line-height: ${original} on <${blockElement.tagName.toLowerCase()}>`)
    } else {
        // Fallback: remove the style attribute
        blockElement.style.removeProperty("line-height")
        logger.info(`Removed line-height style on <${blockElement.tagName.toLowerCase()}>`)
    }

    blockElement.removeAttribute(ADJUSTED_MARKER)
    originalLineHeights.delete(blockElement)
    blockElementRefCount.delete(blockElement)
}

/**
 * Main entry point: Adjust line-height if needed based on space calculation.
 *
 * @param anchor - The element near the translated text (V1: anchor span; V2: text node's parentElement)
 * @param spaceCalc - Space calculation details from styleCalculator
 * @returns The block element that was adjusted, or null if no adjustment was made
 */
export function adjustLineHeightIfNeeded(anchor: HTMLElement | null, spaceCalc: SpaceCalculation): HTMLElement | null {
    if (!anchor) {
        logger.warn("No anchor element provided")
        return null
    }

    // Find the nearest block ancestor
    const blockAncestor = findNearestBlockAncestor(anchor)
    if (!blockAncestor) {
        logger.warn("Could not find block ancestor for line-height adjustment")
        return null
    }

    // If this block is already adjusted, register a reference regardless of whether
    // additional increase is needed now. This ensures the adjustment persists as long
    // as any anchor within the block exists.
    if (blockAncestor.hasAttribute(ADJUSTED_MARKER)) {
        const current = blockElementRefCount.get(blockAncestor) || 0
        const next = current + 1
        blockElementRefCount.set(blockAncestor, next)
        logger.info(`Existing adjusted block detected. Incrementing ref count to ${next} on <${blockAncestor.tagName.toLowerCase()}>`)
        return blockAncestor
    }

    // Calculate required increase
    const increase = calculateRequiredLineHeightIncrease(spaceCalc)

    // Apply adjustment if needed
    if (increase > 0) {
        applyLineHeightAdjustment(blockAncestor, increase)
        return blockAncestor
    }

    return null
}

/**
 * Restore line-height for the block ancestor of an anchor element.
 * This is a convenience wrapper that finds the block ancestor and restores it.
 *
 * @param anchor - The anchor element (the wrapped translated text)
 */
export function restoreLineHeightForAnchor(anchor: HTMLElement | null): void {
    if (!anchor) {
        return
    }

    // Find the nearest block ancestor
    const blockAncestor = findNearestBlockAncestor(anchor)
    if (!blockAncestor) {
        return
    }

    // Restore line-height (with reference counting)
    restoreLineHeight(blockAncestor)
}
