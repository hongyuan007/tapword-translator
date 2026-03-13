/**
 * @file clipVisibility.ts
 * Helpers for determining whether range rects remain visible after ancestor clipping.
 */

const CLIPPING_OVERFLOW_VALUES = new Set(["hidden", "clip", "scroll", "auto"])

function isClippingOverflowValue(value: string): boolean {
    return CLIPPING_OVERFLOW_VALUES.has(value)
}

export function findClippingAncestors(element: HTMLElement | null): HTMLElement[] {
    const ancestors: HTMLElement[] = []
    let current = element?.parentElement ?? null

    while (current && current.tagName !== "HTML") {
        const styles = window.getComputedStyle(current)
        const overflowX = styles.getPropertyValue("overflow-x")
        const overflowY = styles.getPropertyValue("overflow-y")
        const hasClipOverflow = overflowX === "clip" || overflowY === "clip"
        const clipsHorizontally = isClippingOverflowValue(overflowX) && current.scrollWidth > current.clientWidth
        const clipsVertically = isClippingOverflowValue(overflowY) && current.scrollHeight > current.clientHeight

        if (hasClipOverflow || clipsHorizontally || clipsVertically) {
            ancestors.push(current)
        }

        current = current.parentElement
    }

    return ancestors
}

export function isRectVisibleInClipChain(rect: DOMRect, clippingAncestors: HTMLElement[]): boolean {
    let visibleLeft = rect.left
    let visibleTop = rect.top
    let visibleRight = rect.right
    let visibleBottom = rect.bottom

    for (const ancestor of clippingAncestors) {
        const ancestorRect = ancestor.getBoundingClientRect()
        visibleLeft = Math.max(visibleLeft, ancestorRect.left)
        visibleTop = Math.max(visibleTop, ancestorRect.top)
        visibleRight = Math.min(visibleRight, ancestorRect.right)
        visibleBottom = Math.min(visibleBottom, ancestorRect.bottom)

        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
            return false
        }
    }

    return true
}
