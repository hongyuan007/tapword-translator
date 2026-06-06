/**
 * Content Script - Main Entry Point
 *
 * Coordinates the translation workflow:
 * 1. Text selection detection
 * 2. Translation icon display (for manual selection)
 * 3. Direct translation trigger (for double-click)
 * 4. Translation result rendering
 */

import type { PageActivatedMessage, UserSettings } from "@/0_common/types"
import { DEFAULT_USER_SETTINGS } from "@/0_common/types"
import { UNDERLINE_OPACITY, UNDERLINE_OFFSET_INTERNAL_SHIFT_PX } from "@/0_common/constants"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManager from "@/0_common/utils/storageManager"
import * as colorUtils from "@/0_common/utils/colorUtils"
import * as inputListener from "@/1_content/handlers/InputListener"
import "@/1_content/resources/content.css"
import "@/1_content/resources/modal.css"
import * as iconManager from "@/1_content/ui/iconManager"
import * as spaNavigationHandler from "@/1_content/handlers/SpaNavigationHandler"
import * as fullTranslateHandler from "@/1_content/handlers/FullTranslateHandler"
import * as floatingButtonIntegration from "@/1_content/handlers/FloatingButtonIntegration"

const logger = loggerModule.createLogger("content-script")

logger.info("AI Click Translator - Content script loaded")

// Module-level user settings (loaded during init)
let userSettings: UserSettings | null = null

function resolveEffectiveUnderlineOffsetPx(value: number): number {
    return value - UNDERLINE_OFFSET_INTERNAL_SHIFT_PX
}

function applyDynamicStyles(settings: UserSettings) {
    // Use CSS variable for better performance and cleaner code
    document.documentElement.style.setProperty(
        "--ai-translator-underline-offset",
        `${resolveEffectiveUnderlineOffsetPx(settings.tooltipUnderlineOffsetPxV3)}px`
    )
    
    const wordColor = colorUtils.addOpacityToHex(settings.wordUnderlineColorV2, UNDERLINE_OPACITY)
    const sentenceColor = colorUtils.addOpacityToHex(settings.sentenceUnderlineColor, UNDERLINE_OPACITY)
    
    document.documentElement.style.setProperty("--modal-blue-accent-color", wordColor)
    document.documentElement.style.setProperty("--modal-accent-color", sentenceColor)
}

/**
 * Get current user settings
 */
export function getCachedUserSettings(): UserSettings | null {
    return userSettings
}

/**
 * Initialize user settings from storage
 * Loads settings from chrome.storage.sync and sets up change listener
 */
async function initializeUserSettings(): Promise<void> {
    // Load user settings from storage
    try {
        userSettings = await storageManager.getUserSettings()
        applyDynamicStyles(userSettings)
        logger.info("User settings loaded:", userSettings)
    } catch (error) {
        logger.error("Failed to load user settings, using defaults:", error)
        userSettings = DEFAULT_USER_SETTINGS
        applyDynamicStyles(userSettings)
    }

    // Listen for storage changes to update settings dynamically
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes.userSettings) {
            const newSettings = changes.userSettings.newValue as UserSettings
            userSettings = newSettings
            applyDynamicStyles(userSettings)
            logger.info("User settings updated:", newSettings)
        }
    })
}

// Detect extension context invalidation and clean up injected DOM
const invalidationCheckInterval = setInterval(() => {
    if (!chrome.runtime?.id) {
        clearInterval(invalidationCheckInterval)
        logger.info("Extension context invalidated — cleaning up")
        floatingButtonIntegration.destroy()
    }
}, 1000)

/**
 * Initialize the content script
 */
async function init(): Promise<void> {
    // Pre-warm: fire-and-forget, non-blocking. Wakes up the
    // background worker and triggers proactive token refresh.
    chrome.runtime.sendMessage({ type: "PAGE_ACTIVATED" } as PageActivatedMessage).catch(() => {
        // Ignore: background may not be ready yet on first install
    })

    // Initialize user settings
    await initializeUserSettings()

    // Listen for double-click to trigger direct translation
    document.addEventListener("dblclick", inputListener.handleDoubleClick)

    // Registration-order invariant: this capture listener must be registered before the
    // V2 hit-testing capture listener. The same-event suppression path in hitTesting.ts
    // relies on InputListener seeing the click first.
    // Listen for single-click to trigger word translation (capture to avoid page stopPropagation)
    document.addEventListener("click", inputListener.handleSingleClick, { capture: true })

    // Listen for text selection (for manual drag selection)
    document.addEventListener("mouseup", inputListener.handleTextSelection)

    // Listen for clicks on other text elements to hide icon
    document.addEventListener("mousedown", inputListener.handleDocumentClick)

    // Listen for scroll to hide icon
    document.addEventListener("scroll", iconManager.removeTranslationIcon, { passive: true })

    // Cleanup translation UI when SPA navigation changes core URL (ignores hash-only jumps)
    spaNavigationHandler.setup()

    // Initialize floating translation button
    floatingButtonIntegration.setup().catch((error) => {
        logger.error("Failed to initialize floating button:", error)
    })

    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === "FULL_TRANSLATE_TOGGLE") {
            fullTranslateHandler.handleToggle(message.data.enabled, sendResponse)
            return true // keep channel open for async response
        }
        if (message.type === "FULL_TRANSLATE_STATUS_REQUEST") {
            fullTranslateHandler.handleStatusRequest(sendResponse)
            return false
        }
        return false
    })

    logger.info("AI Click Translator - Event listeners registered")
}

// Start the extension
init()
