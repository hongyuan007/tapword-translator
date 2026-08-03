/**
 * Context Extractor V2
 *
 * A simpler, clearer context extraction utility focused on sentences.
 * Input: DOM Range of the user's selection.
 * Output: Selected text, leading/trailing text within current sentence,
 *         full current sentence, and neighboring sentences.
 */

import * as domSanitizer from "@/1_content/utils/domSanitizer"
// logger intentionally omitted for minimal footprint

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface ExtractedContextV2 {
    text: string
    leadingText: string
    trailingText: string
    currentSentence: string
    previousSentences: string[]
    nextSentences: string[]
}

export interface ContextV2Options {
    /** Number of previous sentences to return (default 1) */
    prevCount?: number
    /** Number of next sentences to return (default 1) */
    nextCount?: number
    /** Additional block-level tags that act as hard sentence boundaries/root scopes */
    boundaryTags?: string[]
    /** Sentence terminators used to detect sentence boundaries */
    terminators?: string[]
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TERMINATORS = [".", "?", "!", "。", "？", "！", "…"]
const DEFAULT_HARD_TERMINATORS = [".", "?", "!", "。", "？", "！", "…", "\n"]
const DEFAULT_SOFT_TERMINATORS = [",", "，", ";", "；", ":", "：", "—"]
const MIN_WORD_COUNT = 3
const MIN_CJK_CHARS = 5
const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

// Keep minimal but robust defaults; <p> is the primary boundary, add common blocks
const DEFAULT_BOUNDARY_TAGS = ["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand a selection range to cover the full surrounding sentence.
 * Uses a "Greedy-Short" strategy:
 * 1. Respects hard terminators (., ?, !) as absolute boundaries.
 * 2. Tries to use soft terminators (,, ;, :) to keep the selection short.
 * 3. Expands to the right (Priority) if the soft segment is too short.
 * 4. Expands to the left (Fallback) if the segment is still too short after right expansion.
 */
export function expandRangeToSentence(range: Range, options: ContextV2Options = {}): Range {
    const hardTerminators = new Set((options.terminators ?? DEFAULT_HARD_TERMINATORS).filter(Boolean))
    const softTerminators = new Set(DEFAULT_SOFT_TERMINATORS)
    const allTerminators = new Set([...hardTerminators, ...softTerminators])

    const boundaryTags = new Set((options.boundaryTags ?? DEFAULT_BOUNDARY_TAGS).map((t) => t.toUpperCase()))

    // Resolve root scope
    const root = findBoundaryRoot(range.commonAncestorContainer, boundaryTags) ?? document.body

    // Normalize boundaries
    const startPos = normalizeToTextPosition(root, range.startContainer, range.startOffset)
    const endPos = normalizeToTextPosition(root, range.endContainer, range.endOffset)

    if (!startPos || !endPos) {
        return range.cloneRange()
    }

    // 1. Find the "Hard" limits (Absolute Sandbox) — skip numeric periods (e.g., 3.14)
    const hardStart = findSentenceStartWithin(root, startPos.node, startPos.offset, hardTerminators, true)
    const hardEnd = findSentenceEndWithin(root, endPos.node, endPos.offset, hardTerminators, true)

    if (!hardStart || !hardEnd) {
        return range.cloneRange()
    }

    // 2. Start with the tightest "Soft" boundaries around the selection
    let softStart = findSentenceStartWithin(root, startPos.node, startPos.offset, allTerminators, true)
    let softEnd = findSentenceEndWithin(root, endPos.node, endPos.offset, allTerminators, true)

    // Fallbacks if soft search fails
    if (!softStart) softStart = hardStart
    if (!softEnd) softEnd = hardEnd

    // Clamp soft boundaries to stay within hard limits
    let safeStart = comparePositions(softStart, hardStart) < 0 ? hardStart : softStart
    let safeEnd = comparePositions(softEnd, hardEnd) > 0 ? hardEnd : softEnd

    // 3. Phase 1: Greedy Expansion RIGHT (Priority)
    while (true) {
        const text = extractTextBetween(safeStart, safeEnd)
        
        // If length is sufficient or we've reached the hard limit, stop right expansion
        if (!isSegmentShort(text) || comparePositions(safeEnd, hardEnd) >= 0) {
            break
        }

        // Search for next boundary starting from current safeEnd
        const nextEnd = findSentenceEndWithin(root, safeEnd.node, safeEnd.offset, allTerminators, true)

        if (!nextEnd || comparePositions(nextEnd, hardEnd) >= 0) {
            safeEnd = hardEnd
            break
        }

        if (comparePositions(nextEnd, safeEnd) <= 0) {
             safeEnd = hardEnd
             break
        }

        safeEnd = nextEnd
    }

    // 4. Phase 2: Greedy Expansion LEFT (Fallback)
    // Only strictly necessary if we are STILL short (meaning we likely hit hardEnd on the right)
    while (true) {
        const text = extractTextBetween(safeStart, safeEnd)

        // If length is sufficient or we've reached the hard limit, stop left expansion
        if (!isSegmentShort(text) || comparePositions(safeStart, hardStart) <= 0) {
            break
        }

        // Search for previous boundary.
        // safeStart points to the position *after* the previous terminator (index + 1).
        // To find the terminator *before* that, we need to search backwards from safeStart.offset - 1.
        
        let searchNode = safeStart.node
        let searchOffset = safeStart.offset

        if (searchOffset > 0) {
            searchOffset -= 1
        } else {
            // Need to jump to previous text node
            const prev = getPrevTextNode(root, searchNode)
            if (!prev) {
                safeStart = hardStart
                break
            }
            searchNode = prev
            searchOffset = textLength(prev)
        }

        const prevStart = findSentenceStartWithin(root, searchNode, searchOffset, allTerminators, true)

        if (!prevStart || comparePositions(prevStart, hardStart) <= 0) {
            safeStart = hardStart
            break
        }
        
        // No forward progress check needed for backward search typically, but good for safety
        if (comparePositions(prevStart, safeStart) >= 0) {
            safeStart = hardStart
            break
        }

        safeStart = prevStart
    }

    const newRange = document.createRange()
    newRange.setStart(safeStart.node, safeStart.offset)
    newRange.setEnd(safeEnd.node, safeEnd.offset)
    return newRange
}

function comparePositions(a: NodePosition, b: NodePosition): number {
    if (a.node === b.node) {
        return a.offset - b.offset
    }
    const cmp = a.node.compareDocumentPosition(b.node)
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
}

function isSegmentShort(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return true
    
    // CJK detection (simple range check)
    const hasCJK = CJK_PATTERN.test(trimmed)
    
    if (hasCJK) {
        // For CJK, just check character length (e.g., < 5 chars is short)
        return trimmed.length < MIN_CJK_CHARS
    } else {
        // For space-delimited, check word count
        const words = trimmed.split(/\s+/).filter((word) => /[a-zA-Z0-9]/.test(word))
        return words.length < MIN_WORD_COUNT
    }
}


/**
 * Extract sentence-level context around a selection range.
 */
export function extractContextV2(range: Range, options: ContextV2Options = {}): ExtractedContextV2 {
    if (range.collapsed) {
        return minimal("")
    }

    const terminators = new Set((options.terminators ?? DEFAULT_TERMINATORS).filter(Boolean))
    const boundaryTags = new Set((options.boundaryTags ?? DEFAULT_BOUNDARY_TAGS).map((t) => t.toUpperCase()))
    const prevCount = Math.max(0, options.prevCount ?? 1)
    const nextCount = Math.max(0, options.nextCount ?? 1)

    // Selected text (sanitized)
    const text = domSanitizer.getCleanTextFromRange(range).trim()

    // Resolve a sensible root scope (nearest boundary tag or BODY)
    const root = findBoundaryRoot(range.commonAncestorContainer, boundaryTags) ?? document.body

    // Normalize boundaries to text positions
    const startPos = normalizeToTextPosition(root, range.startContainer, range.startOffset)
    const endPos = normalizeToTextPosition(root, range.endContainer, range.endOffset)

    if (!startPos || !endPos) {
        return minimal(text)
    }

    // Locate sentence boundaries within the same root scope
    const sentenceStart = findSentenceStartWithin(root, startPos.node, startPos.offset, terminators)
    const sentenceEnd = findSentenceEndWithin(root, endPos.node, endPos.offset, terminators)

    if (!sentenceStart || !sentenceEnd) {
        return minimal(text)
    }

    // Build leading/trailing text and current sentence
    const leadingText = extractTextBetween(sentenceStart, startPos)
    const trailingText = extractTextBetween(endPos, sentenceEnd)
    const currentSentence = collapseWhitespace(`${leadingText}${text}${trailingText}`).trim()

    // Previous/Next sentences by aggregating text outside current sentence within root
    const previousSentences = extractNeighborSentences(root, null, sentenceStart, terminators, "previous", prevCount)
    const nextSentences = extractNeighborSentences(root, sentenceEnd, null, terminators, "next", nextCount)

    return {
        text,
        leadingText,
        trailingText,
        currentSentence,
        previousSentences,
        nextSentences,
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface NodePosition {
    node: Text
    offset: number
}

function minimal(text: string): ExtractedContextV2 {
    return { text, leadingText: "", trailingText: "", currentSentence: text, previousSentences: [], nextSentences: [] }
}

function collapseWhitespace(s: string): string {
    return s.replace(/\s+/g, " ")
}

function findBoundaryRoot(node: Node, boundaryTags: Set<string>): Element | null {
    let cur: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    while (cur && cur !== document.body) {
        if (cur.nodeType === Node.ELEMENT_NODE) {
            const el = cur as Element
            if (boundaryTags.has(el.tagName)) return el
        }
        cur = cur.parentElement
    }
    return document.body
}

function createLocalTextWalker(root: Node): TreeWalker {
    const filter: NodeFilter = {
        acceptNode: (n: Node) => {
            if (n.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_SKIP
            return domSanitizer.isInsideIgnoredElement(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        },
    }
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter)
}

function getFirstTextNode(root: Node): Text | null {
    if (root.nodeType === Node.TEXT_NODE) return root as Text
    const walker = createLocalTextWalker(root)
    const n = walker.nextNode()
    return (n as Text) || null
}

function getLastTextNode(root: Node): Text | null {
    if (root.nodeType === Node.TEXT_NODE) return root as Text
    const walker = createLocalTextWalker(root)
    let last: Node | null = null
    let cur: Node | null
    while ((cur = walker.nextNode())) last = cur
    return (last as Text) || null
}

function getPrevTextNode(root: Node, from: Node): Text | null {
    const walker = createLocalTextWalker(root)
    walker.currentNode = from
    const n = walker.previousNode()
    return (n as Text) || null
}

function getNextTextNode(root: Node, from: Node): Text | null {
    const walker = createLocalTextWalker(root)
    walker.currentNode = from
    const n = walker.nextNode()
    return (n as Text) || null
}

function textLength(t: Text): number {
    return (t.textContent || "").length
}

function normalizeToTextPosition(root: Node, node: Node, offset: number): NodePosition | null {
    if (node.nodeType === Node.TEXT_NODE) {
        const t = node as Text
        const clamped = Math.min(Math.max(offset, 0), textLength(t))
        return { node: t, offset: clamped }
    }

    // If element: try to find a text node at or near this boundary
    // Prefer the next text node in document order when offset points past children
    const el = node as Element
    if (el.childNodes && el.childNodes.length > 0) {
        // Try to descend to the first text node if offset == 0
        if (offset === 0) {
            const first = getFirstTextNode(el)
            if (first) return { node: first, offset: 0 }
        }
        // Try to use the last text node if offset >= child count
        if (offset >= el.childNodes.length) {
            const last = getLastTextNode(el)
            if (last) return { node: last, offset: textLength(last) }
        }
    }

    // Fallback: use nearest text node within root
    const after = getNextTextNode(root, node)
    if (after) return { node: after, offset: 0 }
    const before = getPrevTextNode(root, node)
    if (before) return { node: before, offset: textLength(before) }
    return null
}



function findSentenceEndWithin(root: Node, node: Text, offset: number, terminators: Set<string>, skipNumeric: boolean = false): NodePosition | null {
    // Inspect current node after offset
    const text = node.textContent || ""
    const after = text.substring(offset)
    const idx = firstTerminatorIndex(after, terminators, skipNumeric)
    if (idx >= 0) return { node, offset: offset + idx + 1 }

    // Traverse forward across text nodes within root
    let cur: Text | null = node
    let prev: Text | null = node
    while ((cur = getNextTextNode(root, cur))) {
        // Check for block boundary crossing
        if (isBlockBoundaryCrossed(cur, prev)) {
             // We crossed into a new block.
             // The sentence (from prev) ends at the end of prev.
             return { node: prev, offset: textLength(prev) }
        }

        const s = cur.textContent || ""
        const j = firstTerminatorIndex(s, terminators, skipNumeric)
        if (j >= 0) return { node: cur, offset: j + 1 }
        
        prev = cur
    }

    // Reached root end
    const last = getLastTextNode(root)
    return last ? { node: last, offset: textLength(last) } : null
}

function findSentenceStartWithin(root: Node, node: Text, offset: number, terminators: Set<string>, skipNumeric: boolean = false): NodePosition | null {
    // Inspect current node before offset
    const text = node.textContent || ""
    const before = text.substring(0, offset)
    const idx = lastTerminatorIndex(before, terminators, skipNumeric)
    if (idx >= 0) return { node, offset: idx + 1 }

    // Traverse backwards across text nodes within root
    let cur: Text | null = node
    let prev: Text | null = node
    while ((cur = getPrevTextNode(root, cur))) {
        // Check for block boundary crossing
        if (isBlockBoundaryCrossed(cur, prev)) {
             // We crossed a block boundary.
             // The sentence (from prev) starts at the beginning of prev.
             return { node: prev, offset: 0 }
        }

        const s = cur.textContent || ""
        const j = lastTerminatorIndex(s, terminators, skipNumeric)
        if (j >= 0) return { node: cur, offset: j + 1 }
        
        prev = cur
    }

    // Reached root start
    const first = getFirstTextNode(root)
    return first ? { node: first, offset: 0 } : null
}

function isBlockBoundaryCrossed(nodeA: Node, nodeB: Node): boolean {
    const common = getCommonAncestor(nodeA, nodeB)
    if (hasBlockInPath(nodeA, common)) return true
    if (hasBlockInPath(nodeB, common)) return true
    return false
}

function getCommonAncestor(a: Node, b: Node): Node | null {
    if (a === b) return a
    if (a.contains(b)) return a
    if (b.contains(a)) return b
    
    // Traverse up from a
    const parents = new Set<Node>()
    let p: Node | null = a
    while (p) {
        parents.add(p)
        p = p.parentNode
    }
    
    // Traverse up from b until match
    p = b
    while (p) {
        if (parents.has(p)) return p
        p = p.parentNode
    }
    return null
}

function hasBlockInPath(node: Node, ancestor: Node | null): boolean {
    let cur: Node | null = node.parentElement
    while (cur && cur !== ancestor) {
        if (cur.nodeType === Node.ELEMENT_NODE) {
            const el = cur as Element
            if (domSanitizer.BLOCK_ELEMENTS.has(el.tagName)) return true
        }
        cur = cur.parentNode
    }
    return false
}

function extractTextBetween(start: NodePosition, end: NodePosition): string {
    const r = document.createRange()
    r.setStart(start.node, start.offset)
    r.setEnd(end.node, end.offset)
    const raw = domSanitizer.getCleanTextFromRange(r)
    r.detach()
    return collapseWhitespace(raw)
}

/**
 * Check if a comma at `index` in `text` is part of a number pattern (e.g., 10,000, 1,500,000).
 * Only returns true when digits appear on both sides of the comma.
 */
function isCommaInsideNumber(text: string, index: number): boolean {
    const ch = text[index]
    if (ch !== ',' && ch !== '\uff0c') return false
    const before = text[index - 1]
    const after = text[index + 1]
    return /\d/.test(before ?? '') && /\d/.test(after ?? '')
}

/**
 * Check if a period at `index` in `text` is part of a decimal number (e.g., 3.14, 0.5).
 */
function isPeriodInsideNumber(text: string, index: number): boolean {
    if (text[index] !== '.') return false
    const before = text[index - 1]
    const after = text[index + 1]
    return /\d/.test(before ?? '') && /\d/.test(after ?? '')
}

function lastTerminatorIndex(s: string, terminators: Set<string>, skipNumeric: boolean = false): number {
    let best = -1
    for (const ch of terminators) {
        let idx = s.length - 1
        while (idx >= 0) {
            const found = s.lastIndexOf(ch, idx)
            if (found === -1) break
            if (skipNumeric && isCommaInsideNumber(s, found)) {
                idx = found - 1
                continue
            }
            if (skipNumeric && isPeriodInsideNumber(s, found)) {
                idx = found - 1
                continue
            }
            if (found > best) best = found
            break
        }
    }
    return best
}

function firstTerminatorIndex(s: string, terminators: Set<string>, skipNumeric: boolean = false): number {
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!
        if (!terminators.has(ch)) continue
        if (skipNumeric && isCommaInsideNumber(s, i)) continue
        if (skipNumeric && isPeriodInsideNumber(s, i)) continue
        return i
    }
    return -1
}

function buildSplitRegex(terminators: Set<string>): RegExp {
    const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Char class for single-character terminators
    const chars = Array.from(terminators).map(escape).join("")
    // Split after a terminator, consume trailing spaces
    return new RegExp(`(?<=[${chars}])\\s*`, "g")
}

function extractNeighborSentences(
    root: Node,
    fromExclusive: NodePosition | null,
    toExclusive: NodePosition | null,
    terminators: Set<string>,
    direction: "previous" | "next",
    count: number
): string[] {
    if (count === 0) return []

    const r = document.createRange()

    if (direction === "previous") {
        // [root start, sentenceStart)
        const first = getFirstTextNode(root)
        if (!first || !toExclusive) return []
        r.setStart(first, 0)
        r.setEnd(toExclusive.node, toExclusive.offset)
    } else {
        // (sentenceEnd, root end]
        const last = getLastTextNode(root)
        if (!last || !fromExclusive) return []
        r.setStart(fromExclusive.node, fromExclusive.offset)
        r.setEnd(last, textLength(last))
    }

    const raw = domSanitizer.getCleanTextFromRange(r)
    r.detach()

    const splitRe = buildSplitRegex(terminators)
    const parts = raw
        .split(splitRe)
        .map((s) => collapseWhitespace(s).trim())
        .filter((s) => s.length > 0)

    if (direction === "previous") {
        return parts.slice(-count)
    } else {
        return parts.slice(0, count)
    }
}
