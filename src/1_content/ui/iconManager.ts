/**
 * Translation Icon Manager
 *
 * Manages the display and positioning of the translation trigger icon
 */

import * as constants from "@/1_content/constants"
import type * as types from "@/0_common/types"

// Global state
let currentIcon: HTMLElement | null = null
let showIconTimeoutId: number | null = null // For delayed show
const DOUBLE_CLICK_THRESHOLD = 20 // ms

/** Icon element dimensions (matches SVG viewBox) */
const ICON_SIZE = 24
/** Gap between selection boundary and icon */
const POSITION_GAP = 4
/** Minimum padding from viewport edges */
const VIEWPORT_PAD = 2

/**
 * Create the translation icon element
 */
function createTranslationIcon(onClick: (event: Event) => void, iconColor: types.IconColor): HTMLElement {
    const colorHex = constants.ICON_COLORS[iconColor] || constants.ICON_COLORS.pink
    const icon = document.createElement("div")
    icon.className = constants.CSS_CLASSES.ICON
    icon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="${colorHex}" opacity="0.85"/>
            <path d="M8 9L11 12L8 15M14 9L17 12L14 15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `
    icon.title = "Click to translate"
    // Prevent the selection from collapsing when the user clicks the icon.
    icon.addEventListener("mousedown", (e) => e.preventDefault())
    icon.addEventListener("click", onClick)
    return icon
}

/**
 * Get scroll offsets, handling body-scroll pages (Quirks Mode)
 */
function getScrollOffset(): { scrollX: number; scrollY: number } {
    const winScrollY = window.scrollY || document.documentElement.scrollTop || 0
    const winScrollX = window.scrollX || document.documentElement.scrollLeft || 0
    return {
        scrollY: winScrollY + (winScrollY === 0 ? (document.body?.scrollTop || 0) : 0),
        scrollX: winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0),
    }
}

/**
 * Calculate position for a specific corner relative to a selection rect
 */
function calculateCornerPosition(
    rect: DOMRect,
    scroll: { scrollX: number; scrollY: number },
    corner: types.IconPosition,
): { top: number; left: number } {
    const gap = POSITION_GAP
    switch (corner) {
        case "bottom-left":
            return {
                top: rect.bottom + scroll.scrollY + gap,
                left: rect.left + scroll.scrollX - ICON_SIZE - gap,
            }
        case "top-right":
            return {
                top: rect.top + scroll.scrollY - ICON_SIZE - gap,
                left: rect.right + scroll.scrollX + gap,
            }
        case "top-left":
            return {
                top: rect.top + scroll.scrollY - ICON_SIZE - gap,
                left: rect.left + scroll.scrollX - ICON_SIZE - gap,
            }
        case "bottom-right":
        default:
            return {
                top: rect.bottom + scroll.scrollY + gap,
                left: rect.right + scroll.scrollX + gap,
            }
    }
}

/**
 * Clamp icon position so it stays within the viewport
 */
function clampToViewport(top: number, left: number): { top: number; left: number } {
    const clampedTop = Math.max(0, Math.min(top, window.innerHeight + window.scrollY - ICON_SIZE - VIEWPORT_PAD))
    const clampedLeft = Math.max(0, Math.min(left, window.innerWidth + window.scrollX - ICON_SIZE - VIEWPORT_PAD))
    return { top: clampedTop, left: clampedLeft }
}

/**
 * Calculate the best corner for auto mode based on available viewport space
 */
function computeAutoCorner(rect: DOMRect): types.IconPosition {
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const spaceRight = window.innerWidth - rect.right
    const spaceLeft = rect.left

    // Prefer bottom-right, then choose corner with most space
    const corners: Array<{ corner: types.IconPosition; space: number }> = [
        { corner: "bottom-right", space: Math.min(spaceBelow, spaceRight) },
        { corner: "bottom-left", space: Math.min(spaceBelow, spaceLeft) },
        { corner: "top-right", space: Math.min(spaceAbove, spaceRight) },
        { corner: "top-left", space: Math.min(spaceAbove, spaceLeft) },
    ]

    corners.sort((a, b) => b.space - a.space)
    return corners[0]?.corner ?? "bottom-right"
}

/**
 * Calculate optimal position for the icon based on selection bounds and position setting
 */
function calculateIconPosition(range: Range, iconPosition: types.IconPosition): { top: number; left: number } {
    const rects = range.getClientRects()
    if (rects.length === 0) {
        return { top: 0, left: 0 }
    }

    const rect = rects[rects.length - 1]
    if (!rect) {
        return { top: 0, left: 0 }
    }

    const scroll = getScrollOffset()
    const effectiveCorner = iconPosition === "auto" ? computeAutoCorner(rect) : iconPosition
    const pos = calculateCornerPosition(rect, scroll, effectiveCorner)
    return clampToViewport(pos.top, pos.left)
}

/**
 * Show the translation icon near the selected text after a short delay.
 * This delay prevents the icon from appearing during a double-click.
 */
export function showTranslationIcon(
    range: Range,
    onClick: (event: Event) => void,
    iconColor: types.IconColor,
    iconPosition: types.IconPosition,
): void {
    // Remove any existing icon or cancel any pending icon display.
    removeTranslationIcon()

    showIconTimeoutId = window.setTimeout(() => {
        // Create and position new icon
        const icon = createTranslationIcon(onClick, iconColor)
        const position = calculateIconPosition(range, iconPosition)

        icon.style.top = `${position.top}px`
        icon.style.left = `${position.left}px`

        // Add to document
        document.body.appendChild(icon)

        // Store reference
        currentIcon = icon

        // Trigger fade-in animation
        setTimeout(() => {
            icon.classList.add("visible")
        }, 10)

        showIconTimeoutId = null // Clear timeout ID after execution
    }, DOUBLE_CLICK_THRESHOLD)
}

/**
 * Remove the translation icon or cancel its pending display.
 */
export function removeTranslationIcon(): void {
    // If a timeout is pending to show an icon, cancel it.
    if (showIconTimeoutId) {
        clearTimeout(showIconTimeoutId)
        showIconTimeoutId = null
    }

    // If an icon is already visible, fade it out and remove it.
    if (currentIcon) {
        const iconToRemove = currentIcon
        iconToRemove.classList.remove("visible")
        setTimeout(() => {
            iconToRemove.remove()
        }, 200) // Wait for fade-out animation to complete
        currentIcon = null
    }
}
