/**
 * Popup Script - Settings and Configuration UI Handler
 *
 * This is the main entry point for the popup. It orchestrates:
 * 1. i18n initialization and translation
 * 2. Settings loading and event binding
 * 3. Website link and update notification
 * 4. Tooltip positioning
 * 5. Loading state management
 */

import * as i18nModule from "@/0_common/utils/i18n"
import { APP_EDITION } from "@/0_common/constants"
import type {
    FullTranslateStatusRequestMessage,
    FullTranslateStatusResponseMessage,
    FullTranslateToggleMessage,
    FullTranslateToggleResponseMessage,
} from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import { FLOATING_BUTTON_STORAGE_KEY, DEFAULT_CONFIG } from "@/12_floating_button/constants"
import type { FloatingButtonConfig } from "@/12_floating_button/types"
import * as settingsManagerModule from "./modules/settingsManager"
import * as tooltipManagerModule from "./modules/tooltipManager"
import * as quotaDisplayModule from "./modules/quotaDisplay"
import "./styles/popup.css"

const logger = loggerModule.createLogger("Popup")

// Stamp edition for conditional UI states (e.g., hide audio settings in community builds)
document.documentElement.setAttribute("data-app-edition", APP_EDITION)

/**
 * Initialize popup
 */
async function initialize(): Promise<void> {
    logger.info("Popup initializing")

    // Initialize i18n and apply translations
    i18nModule.initI18n()
    i18nModule.applyTranslations()
    logger.info(`UI language set to: ${i18nModule.getCurrentLocale()}`)

    // Load current settings
    await settingsManagerModule.loadSettings()

    // Set up setting change listeners
    const resetFullTranslateState = await setupFullTranslateButton()
    settingsManagerModule.setupSettingChangeListeners({ onTapWordDisabled: resetFullTranslateState })

    // Set up tooltip interactions
    const helpIcons = document.querySelectorAll<HTMLElement>(".help-icon")
    const popupContainer = document.querySelector<HTMLElement>(".popup-container")

    tooltipManagerModule.setupTooltipClickHandlers(helpIcons, popupContainer)

    if (popupContainer) {
        tooltipManagerModule.setupTooltipPositioning(helpIcons, popupContainer)
    } else {
        logger.warn("Popup container not found, tooltip positioning skipped")
    }

    // Setup settings button
    const settingsButton = document.getElementById("settingsButton")
    if (settingsButton) {
        settingsButton.addEventListener("click", () => {
            chrome.runtime.openOptionsPage()
        })
    }

    // Setup GitHub button
    const githubButton = document.getElementById("githubButton")
    if (githubButton) {
        githubButton.addEventListener("click", (e) => {
            e.preventDefault()
            chrome.tabs.create({ url: "https://github.com/hongyuan007/tapword-translator" })
        })
    }

    // Display version number (prefer version_name for descriptive labels like "0.4.2-tooltipv2")
    const manifest = chrome.runtime.getManifest()
    const versionText = manifest.version_name || manifest.version
    const versionDisplay = document.getElementById("versionDisplay")
    if (versionDisplay) {
        versionDisplay.textContent = `${versionText}`
    }

    // Show community edition subtitle for community builds
    if (APP_EDITION === "community") {
        const communitySubtitle = document.getElementById("communitySubtitle")
        if (communitySubtitle) {
            communitySubtitle.style.display = "block"
        }
    }

    // Setup floating button toggle
    await setupFloatingButtonToggle()

    // Initialize quota display
    await quotaDisplayModule.initQuotaDisplay()

    // Remove loading state to reveal content
    document.documentElement.classList.remove("loading")
    logger.info("Popup initialized")
}

/**
 * Setup floating button toggle — reads/writes directly to chrome.storage.local
 */
async function setupFloatingButtonToggle(): Promise<void> {
    const checkbox = document.getElementById("floatingButtonEnabled") as HTMLInputElement | null
    if (!checkbox) {
        logger.warn("Floating button toggle not found")
        return
    }

    // Load current state
    try {
        const result = await chrome.storage.local.get(FLOATING_BUTTON_STORAGE_KEY)
        const stored = result[FLOATING_BUTTON_STORAGE_KEY] as Partial<FloatingButtonConfig> | undefined
        const config = { ...DEFAULT_CONFIG, ...stored }
        checkbox.checked = config.enabled
    } catch (error) {
        logger.error("Failed to load floating button config:", error)
        checkbox.checked = DEFAULT_CONFIG.enabled
    }

    // Save on toggle
    checkbox.addEventListener("change", async () => {
        try {
            const result = await chrome.storage.local.get(FLOATING_BUTTON_STORAGE_KEY)
            const stored = result[FLOATING_BUTTON_STORAGE_KEY] as Partial<FloatingButtonConfig> | undefined
            const config = { ...DEFAULT_CONFIG, ...stored, enabled: checkbox.checked }
            await chrome.storage.local.set({ [FLOATING_BUTTON_STORAGE_KEY]: config })
            logger.info(`Floating button enabled set to ${checkbox.checked}`)
        } catch (error) {
            logger.error("Failed to save floating button config:", error)
        }
    })
}

/**
 * Setup full-page translate button with toggle behavior
 */
async function setupFullTranslateButton(): Promise<() => void> {
    const button = document.getElementById("fullTranslateButton") as HTMLButtonElement | null
    const label = document.getElementById("fullTranslateLabel")
    if (!button || !label) {
        logger.warn("Full translate button not found")
        return () => { /* no-op: button not found */ }
    }

    let isRunning = await getFullTranslateStatus()
    updateButtonState(button, label, isRunning)

    button.addEventListener("click", () => {
        const enabling = !isRunning

        // Set loading state
        button.classList.add("is-loading")
        button.classList.remove("is-active")
        label.textContent = i18nModule.translate("popup.translatePage.loading")

        const message: FullTranslateToggleMessage = {
            type: "FULL_TRANSLATE_TOGGLE",
            data: { enabled: enabling },
        }

        chrome.runtime.sendMessage(message, (response: FullTranslateToggleResponseMessage) => {
            button.classList.remove("is-loading")

            if (chrome.runtime.lastError) {
                logger.error("Full translate toggle failed:", chrome.runtime.lastError.message)
                updateButtonState(button, label, isRunning)
                return
            }

            // Guard against undefined/error responses (e.g., no content script on restricted pages)
            if (!response || response.error) {
                logger.warn("Full translate unavailable on this page:", response?.error ?? "no response")
                updateButtonState(button, label, isRunning)
                return
            }

            isRunning = response.isRunning
            updateButtonState(button, label, isRunning)
            logger.info(`Full translate toggled: isRunning=${isRunning}`)

            // Close popup after toggling full translation (start or stop)
            window.close()
        })
    })

    // Return a callback to reset the running state when TapWord is disabled externally
    return () => {
        isRunning = false
    }
}

function getFullTranslateStatus(): Promise<boolean> {
    const message: FullTranslateStatusRequestMessage = {
        type: "FULL_TRANSLATE_STATUS_REQUEST",
    }

    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response: FullTranslateStatusResponseMessage) => {
            if (chrome.runtime.lastError) {
                logger.warn("Failed to load full translate status:", chrome.runtime.lastError.message)
                resolve(false)
                return
            }

            if (!response || response.error) {
                logger.info("Full translate status unavailable:", response?.error ?? "no response")
                resolve(false)
                return
            }

            resolve(response.isRunning)
        })
    })
}

/** Update button visual state based on running status */
function updateButtonState(button: HTMLButtonElement, label: HTMLElement, isRunning: boolean): void {
    if (isRunning) {
        button.classList.add("is-active")
        label.textContent = i18nModule.translate("popup.translatePage.stop")
    } else {
        button.classList.remove("is-active")
        label.textContent = i18nModule.translate("popup.translatePage.label")
    }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    logger.info("Popup DOM ready")
    initialize().catch((error) => {
        logger.error("Failed to initialize popup:", error)
    })
})
