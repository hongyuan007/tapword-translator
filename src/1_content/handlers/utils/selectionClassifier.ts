/**
 * Selection Classifier Utility
 *
 * Detects whether a selection range represents a single word or a fragment,
 * and whether the selected word is complete at its boundaries.
 */

import * as domSanitizer from "@/1_content/utils/domSanitizer"
import * as wordBoundaryModule from "@/1_content/handlers/utils/wordBoundary"

// Keep boundary logic in sync with rangeAdjuster
const HYPHEN = "-"

export interface SelectionClassification {
    type: "word" | "fragment"

    leftComplete: boolean
    rightComplete: boolean
    isComplete: boolean
    hasBoundaryWhitespace: boolean
}

/**
 * Classify a selection based on its range.
 * - type: word | fragment (based on presence of internal whitespace)
 * - hasBoundaryWhitespace: whether the raw range text starts/ends with whitespace
 */
export function detectSelectionType(range: Range): SelectionClassification {
    const raw = domSanitizer.getCleanTextFromRange(range)
    const trimmed = raw.trim()

    const hasBoundaryWhitespace =
        raw.length !== trimmed.length && (raw.startsWith(" ") || raw.endsWith(" ") || /^\s/.test(raw) || /\s$/.test(raw))

    // Default to fragment if empty after trim (caller should guard emptiness)
    if (trimmed.length === 0) {
        // Empty content, treat edges as complete
        return { type: "fragment", leftComplete: true, rightComplete: true, isComplete: true, hasBoundaryWhitespace }
    }

    const hasInternalWhitespace = /\s/.test(trimmed)

    // Determine edge completeness by first checking inside characters,
    // then falling back to neighbors outside the range only if needed.
    const firstInsideChar = raw.length > 0 ? raw.charAt(0) : null
    const lastInsideChar = raw.length > 0 ? raw.charAt(raw.length - 1) : null

    let leftComplete: boolean
    if (firstInsideChar && isWordBoundary(firstInsideChar)) {
        leftComplete = true
    } else {
        const leftChar = getLeftNeighborChar(range.startContainer, range.startOffset)
        leftComplete = !leftChar || isWordBoundary(leftChar)
    }

    let rightComplete: boolean
    if (lastInsideChar && isWordBoundary(lastInsideChar)) {
        rightComplete = true
    } else {
        const rightChar = getRightNeighborChar(range.endContainer, range.endOffset)
        rightComplete = !rightChar || isWordBoundary(rightChar)
    }

    const isComplete = leftComplete && rightComplete

    if (!hasInternalWhitespace) {
        // Single token → determine completeness
        return { type: "word", leftComplete, rightComplete, isComplete, hasBoundaryWhitespace }
    }

    return { type: "fragment", leftComplete, rightComplete, isComplete, hasBoundaryWhitespace }
}

function isWordBoundary(char: string): boolean {
    if (char === HYPHEN) return false
    return wordBoundaryModule.WORD_BOUNDARY_REGEX.test(char)
}

function getCharAt(node: Node, offset: number): string | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    const text = (node as Text).textContent || ""
    if (offset < 0 || offset >= text.length) return null
    return text.charAt(offset)
}

// Fetch character immediately to the left of (node, offset), scoped within closest block
function getLeftNeighborChar(node: Node, offset: number): string | null {
    const root = domSanitizer.getClosestBlockAncestor(node)
    if (node.nodeType === Node.TEXT_NODE) {
        const ch = getCharAt(node, offset - 1)
        if (ch !== null) return ch
    }
    const prev = domSanitizer.getPreviousTextNodeWithin(node, root)
    if (!prev) return null
    const text = (prev as Text).textContent || ""
    if (text.length === 0) return null
    return text.charAt(text.length - 1)
}

// Fetch character immediately to the right of (node, offset), scoped within closest block
function getRightNeighborChar(node: Node, offset: number): string | null {
    const root = domSanitizer.getClosestBlockAncestor(node)
    if (node.nodeType === Node.TEXT_NODE) {
        const ch = getCharAt(node, offset)
        if (ch !== null) return ch
    }
    const next = domSanitizer.getNextTextNodeWithin(node, root)
    if (!next) return null
    const text = (next as Text).textContent || ""
    if (text.length === 0) return null
    return text.charAt(0)
}