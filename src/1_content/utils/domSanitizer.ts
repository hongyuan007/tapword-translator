/**
 * DOM Sanitizer Utility
 *
 * Provides functions to filter out UI-specific elements from DOM operations,
 * ensuring that text extraction and traversal logic doesn't accidentally
 * include content from the extension's own UI (e.g., tooltips, icons).
 */

import * as constants from "@/1_content/constants"

const INLINE_DISPLAY_VALUES = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "inline-table", "contents"])
const HIDDEN_ARIA_VALUE = "true"
const VISUALLY_HIDDEN_CLASS_PATTERN = /\b(sr-only|screen-reader|screenreader|visually-hidden)\b/i
const INTERACTIVE_TEXT_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION", "SUMMARY", "LABEL"])
const STRUCTURAL_TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "TH", "TD", "DT", "DD", "LI", "LEGEND", "CAPTION"])

/**
 * Creates a TreeWalker that automatically skips text nodes located inside
 * the extension's UI elements (tooltips, icons, etc.).
 *
 * This is essential for DOM traversal tasks like context extraction or
 * boundary expansion, preventing them from crossing into UI-generated content.
 *
 * @returns A configured TreeWalker instance.
 */
export function createFilteredTextWalker(): TreeWalker {
    const filter: NodeFilter = {
        acceptNode: (node: Node) => {
            // We only care about text nodes
            if (node.nodeType !== Node.TEXT_NODE) {
                return NodeFilter.FILTER_SKIP
            }
            // Reject nodes that are inside our ignored UI elements
            return isReadableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
    }
    // Walk the entire document body for text nodes, applying our filter
    return document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, filter)
}

/**
 * Checks if a given DOM node is a descendant of any of the extension's
 * designated UI container elements.
 *
 * @param node - The node to check.
 * @returns `true` if the node is inside an ignored element, `false` otherwise.
 */
export function isInsideIgnoredElement(node: Node): boolean {
    // Start from the node's parent element
    let el: Element | null = node.parentElement
    while (el && el !== document.body) {
        // Check if the element has any of the CSS classes we want to ignore
        if (el.classList && (el.classList.contains(constants.CSS_CLASSES.TOOLTIP) || el.classList.contains(constants.CSS_CLASSES.ICON))) {
            return true
        }
        // Move up the DOM tree
        el = el.parentElement
    }
    return false
}

export function isReadableTextNode(node: Node): boolean {
    if (node.nodeType !== Node.TEXT_NODE) {
        return false
    }

    const text = node.textContent || ""
    if (text.length === 0) {
        return false
    }

    if (isInsideIgnoredElement(node)) {
        return false
    }

    return !isInsideNonReadableElement(node)
}

/**
 * Extracts clean text content from a DOM Range object by first removing any
 * of the extension's UI elements from a cloned fragment of the range.
 *
 * This prevents text from tooltips or other UI from being included in the
 * selected text.
 *
 * @param r - The DOM Range to clean.
 * @returns The sanitized text content.
 */
export function getCleanTextFromRange(r: Range): string {
    try {
        const root = getWalkerRoot(r)
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node: Node) => {
                if (!rangeIntersectsNode(r, node)) {
                    return NodeFilter.FILTER_SKIP
                }
                return isReadableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
            },
        })

        const segments: string[] = []
        let previousNode: Text | null = null

        while (walker.nextNode()) {
            const node = walker.currentNode as Text
            const slice = getIntersectedTextSlice(r, node)
            if (!slice) {
                continue
            }

            if (previousNode && shouldInsertSpaceBetween(previousNode, node, segments)) {
                segments.push(" ")
            }

            segments.push(slice)
            previousNode = node
        }

        return segments.join("")
    } catch {
        // Fallback to the original range's text if cloning fails
        return r.toString()
    }
}

/**
 * Block-scoped traversal helpers
 *
 * These utilities constrain text traversal within the closest block-level
 * ancestor, preventing cross-block hops while allowing inline merges.
 */

// A conservative list of common block-level tags for scoping traversal
export const BLOCK_ELEMENTS = new Set<string>([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DIV",
    "DL",
    "DT",
    "DD",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "TD",
    "TH",
    "UL",
])

/** Create a TreeWalker over text nodes inside the given root, skipping our UI. */
export function createLocalTextWalker(root: Node): TreeWalker {
    const filter: NodeFilter = {
        acceptNode: (n: Node) => {
            if (n.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_SKIP
            return isReadableTextNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
    }
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter)
}

/** Find the closest block-level ancestor element for a node. */
export function getClosestBlockAncestor(node: Node): Element {
    let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    while (el && el !== document.body) {
        if (BLOCK_ELEMENTS.has(el.tagName)) return el
        el = el.parentElement
    }
    return document.body
}

/** Previous text node within the provided root subtree. */
export function getPreviousTextNodeWithin(node: Node, root: Node): Node | null {
    const walker = createLocalTextWalker(root)
    walker.currentNode = node
    return walker.previousNode()
}

/** Next text node within the provided root subtree. */
export function getNextTextNodeWithin(node: Node, root: Node): Node | null {
    const walker = createLocalTextWalker(root)
    walker.currentNode = node
    return walker.nextNode()
}

export function canExpandAcrossTextNodes(currentNode: Node, adjacentNode: Node): boolean {
    if (!isReadableTextNode(currentNode) || !isReadableTextNode(adjacentNode)) {
        return false
    }

    return areNodesInSameInlineTextFlow(currentNode, adjacentNode)
}

/**
 * Extract surrounding text from range for language detection.
 * Starts from the closest block ancestor and expands upward if needed.
 *
 * @param range - The selection range
 * @param minChars - Minimum characters to extract (default: 150)
 * @returns Text with sufficient context for language detection
 */
export function getSurroundingTextForDetection(range: Range, minChars: number = 150): string {
    try {
        const container = range.commonAncestorContainer
        let blockAncestor = getClosestBlockAncestor(container)

        // Try extracting text from current block
        let extractedText = extractTextFromBlock(blockAncestor)

        // If text is too short, try parent block (up to 2 levels)
        let attempts = 0
        while (extractedText.length < minChars && blockAncestor !== document.body && attempts < 2) {
            attempts++
            const parentElement = blockAncestor.parentElement
            if (!parentElement) break

            const parentBlock = getClosestBlockAncestor(parentElement)
            if (parentBlock === blockAncestor) break // No higher block found

            blockAncestor = parentBlock
            extractedText = extractTextFromBlock(blockAncestor)
        }

        return extractedText.trim() || getCleanTextFromRange(range).trim()
    } catch (error) {
        // Fallback: just return selection text
        return getCleanTextFromRange(range).trim()
    }
}

/**
 * Extract clean text from a block element, skipping UI elements
 */
function extractTextFromBlock(block: Element): string {
    try {
        const range = document.createRange()
        range.selectNodeContents(block)
        return getCleanTextFromRange(range)
    } catch {
        return block.textContent || ""
    }
}

function getWalkerRoot(range: Range): Node {
    const root = range.commonAncestorContainer
    if (root.nodeType === Node.TEXT_NODE) {
        return root.parentElement ?? document.body
    }
    return root
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
    try {
        return range.intersectsNode(node)
    } catch {
        try {
            const nodeRange = document.createRange()
            nodeRange.selectNodeContents(node)
            return !(
                range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 ||
                range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0
            )
        } catch {
            return false
        }
    }
}

function getIntersectedTextSlice(range: Range, node: Text): string {
    const text = node.textContent || ""
    if (!text) {
        return ""
    }

    const startOffset = node === range.startContainer ? range.startOffset : 0
    const endOffset = node === range.endContainer ? range.endOffset : text.length
    return text.slice(startOffset, endOffset)
}

function shouldInsertSpaceBetween(previousNode: Text, currentNode: Text, segments: string[]): boolean {
    const lastChunk = segments[segments.length - 1] || ""
    const previousTail = lastChunk.charAt(lastChunk.length - 1)
    const currentHead = (currentNode.textContent || "").charAt(0)

    if (!previousTail || !currentHead) {
        return false
    }

    if (/\s/.test(previousTail) || /\s/.test(currentHead)) {
        return false
    }

    return !areNodesInSameInlineTextFlow(previousNode, currentNode)
}

function areNodesInSameInlineTextFlow(nodeA: Node, nodeB: Node): boolean {
    if (nodeA === nodeB) {
        return true
    }

    const commonAncestor = getCommonAncestor(nodeA, nodeB)
    if (!commonAncestor) {
        return false
    }

    return pathUsesInlineTextContainersOnly(nodeA, commonAncestor) && pathUsesInlineTextContainersOnly(nodeB, commonAncestor)
}

function pathUsesInlineTextContainersOnly(node: Node, stopAncestor: Node): boolean {
    let current: Node | null = node.parentNode

    while (current && current !== stopAncestor) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const element = current as HTMLElement
            if (isSemanticTextBoundaryElement(element) || isVisuallyHiddenElement(element)) {
                return false
            }
            if (!isInlineTextContainer(element)) {
                return false
            }
        }
        current = current.parentNode
    }

    return true
}

function isInsideNonReadableElement(node: Node): boolean {
    let current: Element | null = node.parentElement

    while (current) {
        if (isVisuallyHiddenElement(current)) {
            return true
        }
        current = current.parentElement
    }

    return false
}

function isVisuallyHiddenElement(element: Element): boolean {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === HIDDEN_ARIA_VALUE) {
        return true
    }

    const className = typeof element.className === "string" ? element.className : ""
    if (VISUALLY_HIDDEN_CLASS_PATTERN.test(className)) {
        return true
    }

    if (!(element instanceof HTMLElement) || !element.isConnected) {
        return false
    }

    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return true
    }

    const hasScreenReaderClip = (style.clip && style.clip !== "auto") || style.clipPath !== "none"
    const isTinyElement = element.offsetWidth <= 1 && element.offsetHeight <= 1
    if (hasScreenReaderClip && isTinyElement) {
        return true
    }

    return false
}

function isSemanticTextBoundaryElement(element: Element): boolean {
    return INTERACTIVE_TEXT_TAGS.has(element.tagName) || STRUCTURAL_TEXT_TAGS.has(element.tagName)
}

function isInlineTextContainer(element: HTMLElement): boolean {
    if (!element.isConnected) {
        return true
    }

    const display = window.getComputedStyle(element).display
    return INLINE_DISPLAY_VALUES.has(display)
}

function getCommonAncestor(a: Node, b: Node): Node | null {
    if (a === b) return a
    if (a.contains(b)) return a
    if (b.contains(a)) return b

    const parents = new Set<Node>()
    let current: Node | null = a
    while (current) {
        parents.add(current)
        current = current.parentNode
    }

    current = b
    while (current) {
        if (parents.has(current)) {
            return current
        }
        current = current.parentNode
    }

    return null
}
