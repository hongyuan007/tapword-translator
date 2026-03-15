/**
 * Range Adjuster Utility
 *
 * Provides functions to trim boundary whitespace and expand a selection range
 * to word boundaries, without performing classification.
 */

import * as domSanitizer from "@/1_content/utils/domSanitizer"
import * as selectionClassifier from "@/1_content/handlers/utils/selectionClassifier"
import * as wordBoundaryModule from "@/1_content/handlers/utils/wordBoundary"

const NBSP = "\u00A0"
const HYPHEN = "-"
const MAX_BOUNDARY_SCAN_LENGTH = 50

export interface TrimResult {
    range: Range
    adjusted: boolean
    hadLeadingWhitespace: boolean
    hadTrailingWhitespace: boolean
}

export interface ExpandResult {
    range: Range
    adjusted: boolean
}

/**
 * Trim leading/trailing whitespace from a selection range without expanding boundaries.
 */
export function trimBoundaryWhitespace(originalRange: Range): TrimResult {
    let startNode: Node = originalRange.startContainer
    let startOffset: number = originalRange.startOffset
    let endNode: Node = originalRange.endContainer
    let endOffset: number = originalRange.endOffset

    let hadLeadingWhitespace = false
    let hadTrailingWhitespace = false

    // Use a local walker limited to the selection's common ancestor to avoid
    // leaking outside the intended subtree when traversing text nodes.
    const root: Node = originalRange.commonAncestorContainer
    const getNextWithin = (node: Node): Node | null => domSanitizer.getNextTextNodeWithin(node, root)
    const getPrevWithin = (node: Node): Node | null => domSanitizer.getPreviousTextNodeWithin(node, root)

    // If boundaries are element nodes (e.g., selectNodeContents), move them to the
    // first/last text node within the root subtree before trimming.
    if (startNode.nodeType !== Node.TEXT_NODE) {
        const first = getFirstTextNodeWithin(root)
        if (first) {
            startNode = first
            startOffset = 0
        }
    }
    if (endNode.nodeType !== Node.TEXT_NODE) {
        const last = getLastTextNodeWithin(root)
        if (last) {
            endNode = last
            const txt = (endNode as Text).textContent || ""
            endOffset = txt.length
        }
    }

    // Advance start forward while first char is whitespace
    while (true) {
        if (startNode.nodeType !== Node.TEXT_NODE) break

        const ch = getCharAt(startNode, startOffset)
        if (ch === null) {
            const next = getNextWithin(startNode)
            if (!next) break
            startNode = next
            startOffset = 0
            continue
        }

        if (isWhitespaceChar(ch)) {
            hadLeadingWhitespace = true
            startOffset += 1
            if (startNode === endNode && startOffset >= endOffset) {
                break
            }
            continue
        }
        break
    }

    // Retreat end backward while last char is whitespace (endOffset is exclusive)
    while (true) {
        if (endNode.nodeType !== Node.TEXT_NODE) break

        const ch = getCharAt(endNode, endOffset - 1)
        if (ch === null) {
            const prev = getPrevWithin(endNode)
            if (!prev) break
            endNode = prev
            const txt = (endNode as Text).textContent || ""
            endOffset = txt.length
            continue
        }

        if (isWhitespaceChar(ch)) {
            hadTrailingWhitespace = true
            endOffset -= 1
            if (startNode === endNode && startOffset >= endOffset) {
                break
            }
            continue
        }
        break
    }

    let finalRange: Range
    try {
        finalRange = document.createRange()
        // If trimming consumed everything, return a collapsed empty range at the
        // trimmed start position.
        const collapsedAfterTrim = startNode === endNode && startOffset >= endOffset
        if (collapsedAfterTrim) {
            const clamped = Math.max(0, startOffset)
            finalRange.setStart(startNode, clamped)
            finalRange.setEnd(startNode, clamped)
        } else {
            finalRange.setStart(startNode, Math.max(0, startOffset))
            finalRange.setEnd(endNode, Math.max(0, endOffset))
        }
    } catch {
        finalRange = originalRange.cloneRange()
    }

    const originalText = domSanitizer.getCleanTextFromRange(originalRange)
    const trimmedText = domSanitizer.getCleanTextFromRange(finalRange)

    const adjusted = hadLeadingWhitespace || hadTrailingWhitespace || originalText !== trimmedText

    return { range: finalRange, adjusted, hadLeadingWhitespace, hadTrailingWhitespace }
}

/**
 * Expand selection to nearest word boundaries on both sides.
 */
export function expandToWordBoundaries(originalRange: Range): ExpandResult {
    let startNode = originalRange.startContainer
    let startOffset = originalRange.startOffset
    let endNode = originalRange.endContainer
    let endOffset = originalRange.endOffset

    let leftScanCount = 0
    let rightScanCount = 0
    let adjusted = false

    // Limit cross-node traversal to within the closest block ancestor on each side.
    const leftRoot = domSanitizer.getClosestBlockAncestor(startNode) || originalRange.commonAncestorContainer
    const rightRoot = domSanitizer.getClosestBlockAncestor(endNode) || originalRange.commonAncestorContainer

    // Expand left boundary
    while (leftScanCount < MAX_BOUNDARY_SCAN_LENGTH) {
        const leftChar = getCharAt(startNode, startOffset - 1)
        if (leftChar === null) {
            // At the beginning of this text node → peek previous text node's last char.
            const prevNode = domSanitizer.getPreviousTextNodeWithin(startNode, leftRoot)
            if (!prevNode) break
            if (!domSanitizer.canExpandAcrossTextNodes(startNode, prevNode)) break
            const prevText = (prevNode as Text).textContent || ""
            if (prevText.length === 0) break
            const lastChar = prevText.charAt(prevText.length - 1)
            if (isWordBoundary(lastChar)) {
                // The previous node ends with a boundary → we've reached the left boundary.
                break
            }
            // Hop into previous node at its end and continue scanning.
            startNode = prevNode
            startOffset = prevText.length
            adjusted = true
            leftScanCount++
            continue
        }
        if (isWordBoundary(leftChar)) {
            break
        }
        startOffset--
        adjusted = true
        leftScanCount++
    }
    // Skip consecutive boundary chars (if any) at the start position within current node
    if (startNode.nodeType === Node.TEXT_NODE) {
        const textLen = ((startNode as Text).textContent || "").length
        while (startOffset < textLen) {
            const nextChar = getCharAt(startNode, startOffset)
            if (nextChar && isWordBoundary(nextChar)) {
                startOffset++
                adjusted = true
            } else {
                break
            }
        }
    }

    // Expand right boundary
    while (rightScanCount < MAX_BOUNDARY_SCAN_LENGTH) {
        const rightChar = getCharAt(endNode, endOffset)

        if (rightChar === null) {
            // At the end of this text node → peek next text node's first char.
            const nextNode = domSanitizer.getNextTextNodeWithin(endNode, rightRoot)
            if (!nextNode) break
            if (!domSanitizer.canExpandAcrossTextNodes(endNode, nextNode)) break
            const nextText = (nextNode as Text).textContent || ""
            if (nextText.length === 0) break
            const firstChar = nextText.charAt(0)
            if (isWordBoundary(firstChar)) {
                // The next node starts with a boundary → we've reached the right boundary.
                break
            }
            // Hop into next node at its start and continue scanning.
            endNode = nextNode
            endOffset = 0
            adjusted = true
            rightScanCount++
            continue
        }

        if (isWordBoundary(rightChar)) {
            break
        }

        endOffset++
        adjusted = true
        rightScanCount++

        // Note: when endOffset reaches the end of this node, the next loop
        // iteration will see rightChar === null and handle hopping (with boundary
        // peek) symmetrically to the left-boundary logic.
    }

    // Trim trailing boundary chars inside range
    while (endOffset > 0) {
        const prevChar = getCharAt(endNode, endOffset - 1)
        if (prevChar && isWordBoundary(prevChar)) {
            endOffset--
            adjusted = true
        } else {
            break
        }
    }

    const expandedRange = document.createRange()
    expandedRange.setStart(startNode, Math.max(0, startOffset))
    expandedRange.setEnd(endNode, Math.max(0, endOffset))

    return { range: expandedRange, adjusted }
}

/**
 * Convenience: Adjust a selection range following our default rules:
 * 1) Trim boundary whitespace.
 * 2) If the result is a 'word' and incomplete, expand to word boundaries.
 * 3) If the result is a 'fragment' and we did not trim boundary whitespace, expand to word boundaries.
 * Returns the adjusted range and whether any modification occurred.
 */
export function adjustSelectionRange(range: Range): { range: Range; adjusted: boolean } {
    const trimRes = trimBoundaryWhitespace(range)
    let workingRange = trimRes.range
    let adjusted = trimRes.adjusted

    const cls = selectionClassifier.detectSelectionType(workingRange)

    if (cls.type === "word") {
        if (!cls.isComplete) {
            const exp = expandToWordBoundaries(workingRange)
            workingRange = exp.range
            adjusted = adjusted || exp.adjusted
        }
    } else {
        // fragment
        if (!trimRes.adjusted) {
            const exp = expandToWordBoundaries(workingRange)
            workingRange = exp.range
            adjusted = adjusted || exp.adjusted
        }
    }

    return { range: workingRange, adjusted }
}

function isWordBoundary(char: string): boolean {
    if (char === HYPHEN) return false
    return wordBoundaryModule.WORD_BOUNDARY_REGEX.test(char)
}

function isWhitespaceChar(char: string): boolean {
    // Treat standard JS whitespace and NBSP as whitespace for trimming
    return /\s/.test(char) || char === NBSP
}

function getCharAt(node: Node, offset: number): string | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    const text = (node as Text).textContent || ""
    if (offset < 0 || offset >= text.length) return null
    return text.charAt(offset)
}

// Note: global previous/next text traversal within the entire document body is intentionally
// avoided in expansion to prevent crossing block-level boundaries. Use the local helpers below.

// Local, range-scoped text traversal helpers

function getFirstTextNodeWithin(root: Node): Node | null {
    if (root.nodeType === Node.TEXT_NODE) return root
    const walker = domSanitizer.createLocalTextWalker(root)
    return walker.nextNode()
}

function getLastTextNodeWithin(root: Node): Node | null {
    if (root.nodeType === Node.TEXT_NODE) return root
    const walker = domSanitizer.createLocalTextWalker(root)
    let last: Node | null = null
    let curr: Node | null
    while ((curr = walker.nextNode())) {
        last = curr
    }
    return last
}
