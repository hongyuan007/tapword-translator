/**
 * Block Text Extractor
 *
 * Extracts full text of a block element with text-node-to-offset mapping.
 * Used by the auto-translation system to build blockText for the candidates API
 * and to map backend-computed offsets back to live DOM positions.
 */

import * as domSanitizer from "@/1_content/utils/domSanitizer"

// ============================================================================
// Types
// ============================================================================

export interface TextNodeSegment {
    node: Text
    /** Start offset of this node's text within the concatenated blockText */
    blockOffset: number
    /** Length of this node's text contribution */
    length: number
}

export interface BlockTextResult {
    /** Full concatenated text of the block */
    blockText: string
    /** Ordered list of text node segments with their offset mapping */
    textNodes: TextNodeSegment[]
    /** The block element itself */
    blockElement: Element
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract full text of a block element with text-node-to-offset mapping.
 * Uses createLocalTextWalker to skip extension UI elements.
 */
export function extractBlockText(blockElement: Element): BlockTextResult {
    const walker = domSanitizer.createLocalTextWalker(blockElement)
    const textNodes: TextNodeSegment[] = []
    let blockText = ""

    let node = walker.firstChild()
    while (node) {
        if (!blockElement.contains(node)) break
        const text = node.textContent || ""
        if (text.length > 0) {
            textNodes.push({
                node: node as Text,
                blockOffset: blockText.length,
                length: text.length,
            })
            blockText += text
        }
        node = walker.nextNode()
        if (node && !blockElement.contains(node)) break
    }

    return { blockText, textNodes, blockElement }
}
