/**
 * @file translationOverlapDetectorV2.ts
 * Range-vs-Range overlap detection for the V2 translation display system.
 *
 * Uses a two-layer strategy:
 *   1. DOM boundary comparison via `compareBoundaryPoints()` (fast, precise)
 *   2. Visual rect overlap via `Range.getClientRects()` (reliable fallback)
 *
 * Layer 2 catches cases where `compareBoundaryPoints` throws (detached nodes,
 * framework-recycled DOM) or returns incorrect results across complex inline
 * element structures — mirroring the Bug A fix pattern.
 */

import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("translationOverlapDetectorV2")

/** Minimum pixel overlap in both axes to consider two rects genuinely overlapping. */
const RECT_OVERLAP_THRESHOLD_PX = 2

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect which active translation ranges overlap with a new selection range.
 * Returns the IDs of translations that should be removed before creating a new one.
 *
 * @param newRange - The Range representing the new selection.
 * @param activeRanges - Map of translation ID → stored Range for all active translations.
 * @returns Array of translation IDs that overlap with `newRange`.
 */
export function detectOverlappingTranslations(
    newRange: Range,
    activeRanges: Map<string, Range>
): string[] {
    const overlapping: string[] = []

    logger.info(`Overlap check: newRange vs ${activeRanges.size} active range(s)`)

    for (const [id, existingRange] of activeRanges) {
        if (rangesOverlap(newRange, existingRange)) {
            overlapping.push(id)
        }
    }

    if (overlapping.length > 0) {
        logger.info("Detected overlapping translations:", overlapping)
    }

    return overlapping
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Check whether two Ranges overlap using a two-layer strategy:
 *   1. DOM boundary comparison (fast path)
 *   2. Visual rect overlap (fallback / verification)
 *
 * If layer 1 confirms overlap, returns `true` immediately.
 * If layer 1 says no overlap or throws, layer 2 provides a second opinion
 * to catch unreliable `compareBoundaryPoints` results.
 *
 * @param a - First Range (typically the new selection).
 * @param b - Second Range (typically an existing active translation).
 * @returns `true` if the ranges share any common content.
 */
function rangesOverlap(a: Range, b: Range): boolean {
    // Layer 1: DOM boundary comparison
    const boundaryResult = checkBoundaryOverlap(a, b)
    if (boundaryResult === true) return true

    // Layer 2: visual rect overlap (fallback for detached nodes, cross-element ranges, etc.)
    const rectResult = checkRectOverlap(a, b)

    if (boundaryResult === false && rectResult) {
        logger.warn("compareBoundaryPoints missed overlap — rect-based check caught it")
    }

    return rectResult
}

/**
 * DOM boundary comparison via `compareBoundaryPoints`.
 * Returns `null` when compareBoundaryPoints throws (detached node, wrong document, etc.).
 */
function checkBoundaryOverlap(a: Range, b: Range): boolean | null {
    try {
        // a ends before b starts → no overlap
        if (a.compareBoundaryPoints(Range.END_TO_START, b) <= 0) return false
        // a starts after b ends → no overlap
        if (a.compareBoundaryPoints(Range.START_TO_END, b) >= 0) return false
        return true
    } catch (e) {
        logger.warn("compareBoundaryPoints threw:", e)
        return null
    }
}

/**
 * Visual overlap check using `Range.getClientRects()`.
 * Two ranges overlap if any pair of their bounding rects share a meaningful
 * overlapping area (greater than `RECT_OVERLAP_THRESHOLD_PX` in both axes).
 */
function checkRectOverlap(a: Range, b: Range): boolean {
    try {
        const aRects = Array.from(a.getClientRects())
        const bRects = Array.from(b.getClientRects())

        if (aRects.length === 0 || bRects.length === 0) return false

        for (const ar of aRects) {
            for (const br of bRects) {
                const overlapX = Math.min(ar.right, br.right) - Math.max(ar.left, br.left)
                const overlapY = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top)
                if (overlapX > RECT_OVERLAP_THRESHOLD_PX && overlapY > RECT_OVERLAP_THRESHOLD_PX) {
                    return true
                }
            }
        }
        return false
    } catch (e) {
        logger.warn("Rect-based overlap check failed:", e)
        return false
    }
}
