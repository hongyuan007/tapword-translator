/**
 * Translation Icon Manager
 *
 * Manages the display and positioning of the translation trigger icon
 */

import * as constants from "@/1_content/constants"
import * as commonConstants from "@/0_common/constants"
import type * as types from "@/0_common/types"

// Global state
let currentIcon: HTMLElement | null = null
let currentExplainIcon: HTMLElement | null = null
let showIconTimeoutId: number | null = null // For delayed show
const DOUBLE_CLICK_THRESHOLD = 20 // ms
const EXPLAIN_ICON_COLOR = "#4A90D9"
const ICON_GAP_PX = 4
const ICON_CONTAINER_SIZE_PX = 32 // Must match .ai-translator-icon / .ai-explain-icon width in CSS

/**
 * Create the translation icon element
 */
function createTranslationIcon(onClick: (event: Event) => void, iconColor: types.IconColor): HTMLElement {
    const colorHex = constants.ICON_COLORS[iconColor] || constants.ICON_COLORS.pink
    const icon = document.createElement("div")
    icon.className = constants.CSS_CLASSES.ICON
    icon.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")
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
 * Calculate optimal position for the icon based on selection bounds
 */
function calculateIconPosition(range: Range): { top: number; left: number } {
    const rects = range.getClientRects()
    if (rects.length === 0) {
        return { top: 0, left: 0 }
    }

    const rect = rects[rects.length - 1]
    if (!rect) {
        return { top: 0, left: 0 }
    }

    // Position icon at bottom-right of selection.
    // On body-scroll pages (window.scrollY stays 0, body.scrollTop accumulates) add
    // body.scrollTop only when window scroll is 0 to avoid double-counting in Quirks Mode.
    const winScrollY = window.scrollY || document.documentElement.scrollTop || 0
    const winScrollX = window.scrollX || document.documentElement.scrollLeft || 0
    const top = rect.bottom + winScrollY + (winScrollY === 0 ? (document.body?.scrollTop  || 0) : 0) + 4
    const left = rect.right  + winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0) + 4

    return { top, left }
}

/**
 * Show the translation icon near the selected text after a short delay.
 * This delay prevents the icon from appearing during a double-click.
 */
export function showTranslationIcon(range: Range, onClick: (event: Event) => void, iconColor: types.IconColor): void {
    // Remove any existing icon or cancel any pending icon display.
    removeTranslationIcon()

    showIconTimeoutId = window.setTimeout(() => {
        // Create and position new icon
        const icon = createTranslationIcon(onClick, iconColor)
        const position = calculateIconPosition(range)

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

    // Always remove explain icon together with translation icon
    removeExplainIcon()
}

/**
 * Create the explain icon element (question-mark circle)
 */
function createExplainIcon(onClick: (event: Event) => void): HTMLElement {
    const icon = document.createElement("div")
    icon.className = constants.CSS_CLASSES.EXPLAIN_ICON
    icon.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")
    icon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="${EXPLAIN_ICON_COLOR}" opacity="0.85"/>
            <text x="12" y="17" text-anchor="middle" fill="white" font-size="14" font-weight="bold" font-family="Arial, sans-serif">?</text>
        </svg>
    `
    icon.title = "Click to explain"
    // Prevent the selection from collapsing when the user clicks the icon.
    icon.addEventListener("mousedown", (e) => e.preventDefault())
    icon.addEventListener("click", onClick)
    return icon
}

/**
 * Show the explain icon to the right of the translation icon.
 * Must be called after showTranslationIcon() so that `currentIcon` is positioned.
 */
export function showExplainIcon(_range: Range, onClick: (event: Event) => void): void {
    removeExplainIcon()

    // Wait for the translation icon to be created (same timeout + small extra)
    const waitMs = DOUBLE_CLICK_THRESHOLD + 5
    setTimeout(() => {
        if (!currentIcon) return

        const icon = createExplainIcon(onClick)

        // Read stable absolute coordinates directly from the translation icon's inline style
        // (getBoundingClientRect is unreliable here because the icon may still have transform: scale(0.8))
        const top = parseFloat(currentIcon.style.top)
        const left = parseFloat(currentIcon.style.left) + ICON_CONTAINER_SIZE_PX + ICON_GAP_PX

        icon.style.top = `${top}px`
        icon.style.left = `${left}px`

        document.body.appendChild(icon)
        currentExplainIcon = icon

        // Trigger fade-in animation
        setTimeout(() => {
            icon.classList.add("visible")
        }, 10)
    }, waitMs)
}

/**
 * Remove the explain icon
 */
export function removeExplainIcon(): void {
    if (currentExplainIcon) {
        const iconToRemove = currentExplainIcon
        iconToRemove.classList.remove("visible")
        setTimeout(() => {
            iconToRemove.remove()
        }, 200)
        currentExplainIcon = null
    }
}
