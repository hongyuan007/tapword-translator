/**
 * Candidate-to-DOM Mapper
 *
 * Maps backend-computed [start, end) offsets in blockText to live DOM Range objects.
 * Each candidate's offsets are deterministically computed by the backend (not LLM),
 * and this module resolves them to precise DOM positions for rendering.
 */

import type { TextNodeSegment } from "@/1_content/utils/blockTextExtractor"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("candidateDomMapper")

// ============================================================================
// Public API
// ============================================================================

/**
 * Map a candidate's [start, end) offsets in blockText to a DOM Range.
 * Returns null if mapping fails or validation fails.
 *
 * @param candidate - Object with text, start, and end offsets
 * @param textNodes - Ordered TextNodeSegment array from extractBlockText()
 * @param blockText - The full block text string
 * @returns A Range if mapping succeeds, or null if validation fails
 */
export function mapCandidateToRange(
    candidate: { text: string; start: number; end: number },
    textNodes: TextNodeSegment[],
    blockText: string
): Range | null {
    // Verify offset correctness against blockText
    const extracted = blockText.substring(candidate.start, candidate.end)
    if (extracted !== candidate.text) {
        logger.warn(`Offset mismatch: expected "${candidate.text}", got "${extracted}"`)
        return null
    }

    // Find start and end text nodes by walking segments
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0

    for (const segment of textNodes) {
        const segStart = segment.blockOffset
        const segEnd = segment.blockOffset + segment.length

        if (!startNode && candidate.start >= segStart && candidate.start < segEnd) {
            startNode = segment.node
            startOffset = candidate.start - segStart
        }

        if (candidate.end > segStart && candidate.end <= segEnd) {
            endNode = segment.node
            endOffset = candidate.end - segStart
        }

        if (startNode && endNode) break
    }

    if (!startNode || !endNode) {
        logger.warn(`Could not locate DOM nodes for candidate "${candidate.text}"`)
        return null
    }

    // Create and validate Range
    try {
        const range = document.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)

        // Validate Range text matches candidate text
        const rangeText = range.toString()
        if (rangeText !== candidate.text) {
            logger.warn(`Range text mismatch: expected "${candidate.text}", got "${rangeText}"`)
            return null
        }

        return range
    } catch (error) {
        logger.warn(`Failed to create Range for "${candidate.text}":`, error)
        return null
    }
}
