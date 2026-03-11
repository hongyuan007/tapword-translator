/**
 * ModalPositioner
 *
 * Helper utility class to compute optimal modal positions relative to an anchor element.
 * It supports two strategies:
 * - word: prioritize four-corner placement (bottom-right > bottom-left > top-right > top-left)
 * - fragment: horizontal x anchored at 3/4 width of the anchor line; use bottom line when placing below,
 *             top line when placing above; clamp to viewport when needed.
 */

export type ModalPositionCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left"

export interface ModalPositionResult {
    /** viewport x (not including page scroll) */
    left: number
    /** viewport y (not including page scroll) */
    top: number
    /** semantic corner label */
    position: ModalPositionCorner
}

const SPACING = 8
const PAD = 10

export class ModalPositioner {
    /**
     * Compute modal viewport coordinates relative to the anchor element.
     *
     * @param anchorElement The wrapped selection anchor element
     * @param modalRect The modal's current bounding rect (size information)
     * @param translationType "word" | "fragment"
     */
    static compute(anchorElement: HTMLElement, modalRect: DOMRect, translationType: "word" | "fragment"): ModalPositionResult {
        // Prepare candidate rects for multi-line anchors
        const { bottomRect, topRect } = this.getTopBottomRects(anchorElement)

        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        if (translationType === "fragment") {
            return this.computeForFragment(bottomRect, topRect, modalRect, viewportWidth, viewportHeight)
        }
        return this.computeForWord(bottomRect, modalRect, viewportWidth, viewportHeight)
    }

    private static getTopBottomRects(anchorElement: HTMLElement): { bottomRect: DOMRect | ClientRect; topRect: DOMRect | ClientRect } {
        const clientRects = anchorElement.getClientRects()
        if (clientRects.length > 0) {
            let bottomMost: DOMRect | ClientRect | null = null
            let topMost: DOMRect | ClientRect | null = null
            for (let i = 0; i < clientRects.length; i++) {
                const r = clientRects.item(i)
                if (!r) continue
                if (!bottomMost || r.bottom > bottomMost.bottom || (r.bottom === bottomMost.bottom && r.right > bottomMost.right)) {
                    bottomMost = r
                }
                if (!topMost || r.top < topMost.top || (r.top === topMost.top && r.right > topMost.right)) {
                    topMost = r
                }
            }
            return { bottomRect: bottomMost as DOMRect | ClientRect, topRect: topMost as DOMRect | ClientRect }
        }
        const rect = anchorElement.getBoundingClientRect()
        return { bottomRect: rect, topRect: rect }
    }

    private static computeForFragment(
        bottomRect: DOMRect | ClientRect,
        topRect: DOMRect | ClientRect,
        modalRect: DOMRect,
        viewportWidth: number,
        viewportHeight: number
    ): ModalPositionResult {
        // X anchors at 3/4 width of the line
        const bottomXAnchor = bottomRect.left + bottomRect.width * 0.75
        const topXAnchor = topRect.left + topRect.width * 0.75

        const spaceBelow = viewportHeight - bottomRect.bottom
        const spaceAbove = topRect.top

        let left = bottomXAnchor
        let top = bottomRect.bottom + SPACING
        let position: ModalPositionCorner = "bottom-right"

        if (spaceBelow >= modalRect.height + SPACING) {
            // keep defaults (below, bottom line anchor)
        } else if (spaceAbove >= modalRect.height + SPACING) {
            position = "top-right"
            left = topXAnchor
            top = topRect.top - modalRect.height - SPACING
        } else {
            // fallback: below (clamp horizontally later)
        }

        // Clamp horizontally within viewport
        const minLeft = PAD
        const maxLeft = viewportWidth - modalRect.width - PAD
        left = Math.max(minLeft, Math.min(left, maxLeft))

        // Ensure non-negative top (minimal pad)
        top = Math.max(PAD, top)

        return { left, top, position }
    }

    private static computeForWord(
        anchorRect: DOMRect | ClientRect,
        modalRect: DOMRect,
        viewportWidth: number,
        viewportHeight: number
    ): ModalPositionResult {
        const spaceRight = viewportWidth - anchorRect.right
        const spaceLeft = anchorRect.left
        const spaceBottom = viewportHeight - anchorRect.bottom
        const spaceTop = anchorRect.top

        let position: ModalPositionCorner
        let left: number
        let top: number

        if (spaceRight >= modalRect.width && spaceBottom >= modalRect.height + SPACING) {
            position = "bottom-right"
            left = anchorRect.right
            top = anchorRect.bottom + SPACING
        } else if (spaceLeft >= modalRect.width && spaceBottom >= modalRect.height + SPACING) {
            position = "bottom-left"
            left = anchorRect.left - modalRect.width
            top = anchorRect.bottom + SPACING
        } else if (spaceRight >= modalRect.width && spaceTop >= modalRect.height + SPACING) {
            position = "top-right"
            left = anchorRect.right
            top = anchorRect.top - modalRect.height - SPACING
        } else if (spaceLeft >= modalRect.width && spaceTop >= modalRect.height + SPACING) {
            position = "top-left"
            left = anchorRect.left - modalRect.width
            top = anchorRect.top - modalRect.height - SPACING
        } else {
            // Fallback: bottom-right with clamping
            position = "bottom-right"
            left = anchorRect.right
            top = anchorRect.bottom + SPACING
            if (left + modalRect.width > viewportWidth) {
                left = viewportWidth - modalRect.width - PAD
            }
            if (top + modalRect.height > viewportHeight) {
                top = viewportHeight - modalRect.height - PAD
            }
        }

        // Final clamps for safety
        left = Math.max(PAD, left)
        top = Math.max(PAD, top)

        return { left, top, position }
    }
}
