/**
 * @file clipVisibility.ts
 * Helpers for determining whether range rects remain visible after clipping and overlay occlusion.
 */

const CLIPPING_OVERFLOW_VALUES = new Set(["hidden", "clip", "scroll", "auto"])
const OCCLUSION_SAMPLE_INSET_PX = 2

type Point = {
    x: number
    y: number
}

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

function clampPoint(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

function buildOcclusionSamplePoints(rect: DOMRect): Point[] {
    const insetX = Math.min(OCCLUSION_SAMPLE_INSET_PX, Math.max(0, rect.width / 4))
    const insetY = Math.min(OCCLUSION_SAMPLE_INSET_PX, Math.max(0, rect.height / 4))
    const left = clampPoint(rect.left + insetX, rect.left, rect.right)
    const right = clampPoint(rect.right - insetX, rect.left, rect.right)
    const top = clampPoint(rect.top + insetY, rect.top, rect.bottom)
    const bottom = clampPoint(rect.bottom - insetY, rect.top, rect.bottom)
    const centerX = clampPoint(rect.left + rect.width / 2, rect.left, rect.right)
    const centerY = clampPoint(rect.top + rect.height / 2, rect.top, rect.bottom)

    return [
        { x: centerX, y: centerY },
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom },
    ]
}

function isPointVisibleToSource(point: Point, sourceElement: HTMLElement, range: Range): boolean {
    const topElement = document.elementFromPoint(point.x, point.y)
    if (!topElement) {
        return false
    }

    if (topElement === sourceElement) {
        return true
    }

    if (sourceElement.contains(topElement) || topElement.contains(sourceElement)) {
        return true
    }

    try {
        return range.intersectsNode(topElement)
    } catch {
        return false
    }
}

export function isRectVisibleForSource(rect: DOMRect, sourceElement: HTMLElement | null, range: Range): boolean {
    if (rect.width <= 0 || rect.height <= 0) {
        return false
    }

    const clippingAncestors = findClippingAncestors(sourceElement)
    if (!isRectVisibleInClipChain(rect, clippingAncestors)) {
        return false
    }

    if (!sourceElement) {
        return true
    }

    const samplePoints = buildOcclusionSamplePoints(rect)
    return samplePoints.some((point) => isPointVisibleToSource(point, sourceElement, range))
}
