/**
 * Translation Overlap Detector
 *
 * Utility for detecting overlapping translation anchors in the DOM.
 * Used to prevent multiple translations from overlapping and causing display issues.
 */

import * as constants from "@/1_content/constants"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("1_content/utils/translationOverlapDetector")

/**
 * Detects translation anchors that overlap with the given range.
 * Returns an array of anchor IDs that should be removed before creating a new translation.
 *
 * @param range - The Range object representing the current selection
 * @returns Array of anchor IDs that overlap with the selection
 */
export function detectOverlappingTranslations(range: Range): string[] {
    const overlappingAnchorIds: string[] = []

    try {
        // Get all translation anchors in the document
        const anchors = document.querySelectorAll(`.${constants.CSS_CLASSES.ANCHOR}`)

        anchors.forEach((anchor) => {
            const anchorElement = anchor as HTMLElement
            const anchorId = anchorElement.id

            if (!anchorId) {
                return
            }

            // Check if the selection range intersects with the anchor element
            const isOverlapping = isElementInRange(anchorElement, range)

            if (isOverlapping) {
                overlappingAnchorIds.push(anchorId)
            }
        })

        if (overlappingAnchorIds.length > 0) {
            logger.info("[OverlapDetector] Detected overlapping translations:", overlappingAnchorIds)
        }
    } catch (error) {
        logger.error("[OverlapDetector] Error detecting overlapping translations:", error)
    }

    return overlappingAnchorIds
}

/**
 * Check if an element is contained within or intersects with a range
 *
 * This method checks if the anchor element itself is part of the selection,
 * using the DOM's native intersectsNode method which properly handles
 * selections that span across multiple text nodes and elements.
 *
 * @param element - The element to check (translation anchor)
 * @param range - The selection range
 * @returns true if element overlaps with the range, false otherwise
 */
function isElementInRange(element: HTMLElement, range: Range): boolean {
    try {
        // Quick path: native intersectsNode properly handles most cases including
        // - element fully contains the selection (outer containment)
        // - selection fully contains the element (inner containment)
        // - partial overlaps and exact equality
        if (range.intersectsNode(element)) {
            return true
        }

        // Additional containment guard for environments where intersectsNode
        // may be unreliable with certain node types
        const elementContainsRange = element.contains(range.startContainer) && element.contains(range.endContainer)
        if (elementContainsRange) {
            return true
        }

        // Fallback: use compareBoundaryPoints for precise boundary checks
        const elementRange = document.createRange()
        elementRange.selectNode(element)

        // Element ends before selection starts: no overlap
        if (elementRange.compareBoundaryPoints(Range.END_TO_START, range) <= 0) {
            return false
        }

        // Element starts after selection ends: no overlap
        if (elementRange.compareBoundaryPoints(Range.START_TO_END, range) >= 0) {
            return false
        }

        // Otherwise, element overlaps with selection
        return true
    } catch (error) {
        logger.error("[OverlapDetector] Error checking element overlap:", error)
        return false
    }
}