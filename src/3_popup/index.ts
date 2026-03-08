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
import * as loggerModule from "@/0_common/utils/logger"
import * as settingsManagerModule from "./modules/settingsManager"
import * as tooltipManagerModule from "./modules/tooltipManager"
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
    settingsManagerModule.setupSettingChangeListeners()

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

    // Display version number (prefer version_name for descriptive labels)
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

    // Remove loading state to reveal content
    document.documentElement.classList.remove("loading")
    logger.info("Popup initialized")
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    logger.info("Popup DOM ready")
    initialize().catch((error) => {
        logger.error("Failed to initialize popup:", error)
    })
})
