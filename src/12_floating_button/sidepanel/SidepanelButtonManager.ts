/**
 * SidepanelButtonManager — Floating button that toggles the Chrome sidepanel.
 *
 * Creates a small round button in the bottom-right corner of the viewport.
 * Clicking it sends a TOGGLE_SIDE_PANEL message to the background service worker.
 * Uses Shadow DOM to isolate styles from the host page.
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as commonConstants from "@/0_common/constants"
import * as constants from "./constants"
import { SIDEPANEL_BUTTON_STYLES } from "./styles"

const logger = loggerModule.createLogger("SidepanelButtonManager")

/** Message type for toggling the side panel */
const TOGGLE_SIDE_PANEL_MESSAGE_TYPE = "TOGGLE_SIDE_PANEL"

/** Sparkles SVG icon — two small stars */
const SPARKLES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
    <path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/>
</svg>`

export class SidepanelButtonManager {
    private hostElement: HTMLDivElement | null = null
    private shadowRoot: ShadowRoot | null = null
    private isInitialized = false

    /**
     * Create and attach the sidepanel floating button to the page.
     */
    initialize(): void {
        if (this.isInitialized) {
            logger.warn("Already initialized")
            return
        }

        this.hostElement = document.createElement("div")
        this.hostElement.className = constants.CLASS_HOST
        this.hostElement.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")

        this.shadowRoot = this.hostElement.attachShadow({ mode: "closed" })

        // Inject styles
        const styleEl = document.createElement("style")
        styleEl.textContent = SIDEPANEL_BUTTON_STYLES
        this.shadowRoot.appendChild(styleEl)

        // Build DOM tree
        const container = document.createElement("div")
        container.className = constants.CLASS_CONTAINER

        const button = document.createElement("button")
        button.className = constants.CLASS_BUTTON
        button.setAttribute("aria-label", "Open AI Sidepanel")
        button.addEventListener("click", this.handleClick)

        const iconWrapper = document.createElement("span")
        iconWrapper.className = constants.CLASS_ICON
        iconWrapper.innerHTML = SPARKLES_SVG

        button.appendChild(iconWrapper)
        container.appendChild(button)
        this.shadowRoot.appendChild(container)

        document.body.appendChild(this.hostElement)
        this.isInitialized = true

        logger.info("Sidepanel button initialized")
    }

    /**
     * Remove the button from the page and clean up.
     */
    destroy(): void {
        if (!this.isInitialized || !this.hostElement) {
            return
        }

        this.hostElement.remove()
        this.hostElement = null
        this.shadowRoot = null
        this.isInitialized = false

        logger.info("Sidepanel button destroyed")
    }

    // --- Internal ---

    private handleClick = (): void => {
        chrome.runtime
            .sendMessage({ type: TOGGLE_SIDE_PANEL_MESSAGE_TYPE })
            .then((response) => {
                if (response?.success) {
                    logger.info("Side panel toggled, isOpen:", response.isOpen)
                } else {
                    logger.warn("Failed to toggle side panel:", response?.error)
                }
            })
            .catch((error) => {
                logger.warn("Error sending TOGGLE_SIDE_PANEL message:", error)
            })
    }
}
