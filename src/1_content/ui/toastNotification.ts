/**
 * Toast Notification Component
 *
 * Displays temporary notification messages at the top center of the viewport.
 * Used for error messages and other brief notifications.
 * Auto-dismisses after 2.5 seconds with slide-down animation.
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as commonConstants from "@/0_common/constants"

const logger = loggerModule.createLogger("toastNotification")

// Toast CSS class name
const TOAST_CLASS = "ai-translator-toast"

// Auto-dismiss duration in milliseconds
const TOAST_DURATION_MS = 2500

// Currently active toast element
let activeToast: HTMLElement | null = null

// Auto-dismiss timer
let dismissTimer: number | null = null

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
