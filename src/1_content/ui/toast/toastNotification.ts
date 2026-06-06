/**
 * Toast Notification Component
 *
 * Displays temporary notification messages at the top center of the viewport.
 * Used for error messages and other brief notifications.
 * Auto-dismisses after 2.5 seconds with slide-down animation.
 *
 * Visual template (HTML structure, design tokens, type-specific config) is
 * defined in `toastTemplate.ts`; this file owns only lifecycle logic
 * (animation, auto-dismiss, close-button wiring, positioning).
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as commonConstants from "@/0_common/constants"
import * as toastTemplate from "@/1_content/ui/toast/toastTemplate"

const logger = loggerModule.createLogger("toastNotification")

// Toast CSS class name
const TOAST_CLASS = "ai-translator-toast"

// Auto-dismiss duration in milliseconds
const TOAST_DURATION_MS = 2500

// Duration for viewport-level toasts (e.g., quota exhaustion)
const VIEWPORT_TOAST_DURATION_MS = 5000

// Animation duration for viewport toast removal
const VIEWPORT_TOAST_ANIMATION_MS = 300

// Currently active toast element
let activeToast: HTMLElement | null = null

// Auto-dismiss timer
let dismissTimer: number | null = null

// Currently active viewport toast element
let activeViewportToast: HTMLElement | null = null

// Viewport toast auto-dismiss timer
let viewportDismissTimer: number | null = null

/**
 * Show a toast notification message
 *
 * @param message - The message to display
 * @param type - The type of toast: 'error' | 'info' | 'success' (defaults to 'error')
 * @param container - Optional container element or shadow root to append toast to (defaults to document.body)
 *
 * @example
 * ```typescript
 * // Show error toast in modal shadow root
 * showToast("语音合成额度用光了", "error", shadowRoot);
 *
 * // Show info toast in document body
 * showToast("翻译已复制到剪贴板", "info");
 * ```
 */
export function showToast(message: string, type: "error" | "info" | "success" = "error", container?: HTMLElement | ShadowRoot): void {
    try {
        // Remove any existing toast first
        if (activeToast) {
            removeToast()
        }

        // Create toast element
        const toast = document.createElement("div")
        toast.className = `${TOAST_CLASS} ${TOAST_CLASS}--${type}`
        toast.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")
        toast.textContent = message

        // Add to specified container, shadow root, or document body
        const targetContainer = container || document.body
        targetContainer.appendChild(toast)
        activeToast = toast

        // Trigger slide-down animation after a brief delay
        requestAnimationFrame(() => {
            toast.classList.add("visible")
        })

        // Auto-dismiss after duration
        dismissTimer = window.setTimeout(() => {
            removeToast()
        }, TOAST_DURATION_MS)

        logger.info("Toast notification shown:", message, type, container ? "in container/shadow" : "in body")
    } catch (error) {
        logger.error("Error showing toast notification:", error)
    }
}

/**
 * Manually remove the current toast notification
 */
export function removeToast(): void {
    if (!activeToast) {
        return
    }

    // Clear auto-dismiss timer
    if (dismissTimer) {
        clearTimeout(dismissTimer)
        dismissTimer = null
    }

    const toastToRemove = activeToast
    activeToast = null

    // Trigger slide-up animation
    toastToRemove.classList.remove("visible")

    // Remove from DOM after animation completes
    setTimeout(() => {
        try {
            toastToRemove.remove()
        } catch (error) {
            logger.warn("Error removing toast element:", error)
        }
    }, 300) // Match CSS animation duration

    logger.info("Toast notification removed")
}

// ============================================================================
// Branded Viewport Toast
// ============================================================================

/**
 * Show a branded toast notification at the top center of the viewport.
 *
 * Uses fully inline styles so it renders correctly on any web page
 * (content script context, no external CSS). Features a white card with
 * the TapWord brand icon, message text, close button, and smooth
 * slide-down / slide-up animations.
 *
 * @param message - The message to display
 * @param type    - Visual variant: 'info' | 'warning' | 'error' | 'success'
 *
 * @example
 * ```typescript
 * showViewportToast("Today's free translation quota has been used up.", "info");
 * ```
 */
export function showViewportToast(message: string, type: toastTemplate.ToastType = "error"): void {
    try {
        if (activeViewportToast) {
            removeViewportToast()
        }

        // Build DOM from template
        const { card, closeBtn } = toastTemplate.createToastElements(message, type)
        card.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")

        // Wire close button
        closeBtn.addEventListener("click", () => {
            removeViewportToast()
        })

        // Mount
        document.body.appendChild(card)
        activeViewportToast = card

        // Trigger entry animation (double rAF for reliable paint)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                card.style.opacity = "1"
                card.style.transform = "translateX(-50%) translateY(0) scale(1)"
            })
        })

        viewportDismissTimer = window.setTimeout(() => {
            removeViewportToast()
        }, VIEWPORT_TOAST_DURATION_MS)

        logger.info("Viewport toast shown:", message)
    } catch (error) {
        logger.error("Error showing viewport toast:", error)
    }
}

/** Remove the current viewport toast with a smooth exit animation */
function removeViewportToast(): void {
    if (!activeViewportToast) {
        return
    }

    if (viewportDismissTimer) {
        clearTimeout(viewportDismissTimer)
        viewportDismissTimer = null
    }

    const toast = activeViewportToast
    activeViewportToast = null

    // Switch to exit transition and animate out
    toast.style.transition = toastTemplate.EXIT_TRANSITION
    toast.style.opacity = "0"
    toast.style.transform = "translateX(-50%) translateY(-10px) scale(0.95)"
    toast.style.pointerEvents = "none"

    setTimeout(() => {
        try {
            toast.remove()
        } catch (error) {
            logger.warn("Error removing viewport toast element:", error)
        }
    }, VIEWPORT_TOAST_ANIMATION_MS)

    logger.info("Viewport toast removed")
}
