/**
 * CloseMenuHandler — manages the X button and its dropdown menu.
 * Dropdown offers "Disable on this site" and "Disable globally" options.
 */

import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import * as constants from "@/12_floating_button/constants"
import type { FloatingButtonConfigStore } from "@/12_floating_button/config/FloatingButtonConfigStore"

const logger = loggerModule.createLogger("CloseMenuHandler")

export class CloseMenuHandler {
    private isOpen = false
    private boundDocumentClick: ((e: MouseEvent) => void) | null = null
    private boundCloseButtonClick: ((e: MouseEvent) => void) | null = null

    /**
     * @param closeButton — The X button element
     * @param dropdown — The dropdown container element
     * @param configStore — Config store for persisting disable actions
     * @param onVisibilityChange — Callback when dropdown opens/closes (for expanded styling)
     * @param onDisable — Callback when the button should be hidden (after disable action)
     */
    constructor(
        private readonly closeButton: HTMLButtonElement,
        private readonly dropdown: HTMLDivElement,
        private readonly configStore: FloatingButtonConfigStore,
        private readonly onVisibilityChange: (isOpen: boolean) => void,
        private readonly onDisable: () => void
    ) {}

    /** Set up the dropdown menu items and attach listeners */
    attach(): void {
        this.buildDropdownItems()

        this.boundCloseButtonClick = this.handleCloseButtonClick.bind(this)
        this.closeButton.addEventListener("click", this.boundCloseButtonClick)

        // Prevent mousedown on close button from triggering parent's drag
        this.closeButton.addEventListener("mousedown", (e: MouseEvent) => {
            e.stopPropagation()
        })
    }

    /** Remove all listeners */
    detach(): void {
        if (this.boundCloseButtonClick) {
            this.closeButton.removeEventListener("click", this.boundCloseButtonClick)
            this.boundCloseButtonClick = null
        }
        this.removeDocumentListener()
    }

    private buildDropdownItems(): void {
        // "Disable on this site" item
        const disableSiteItem = document.createElement("button")
        disableSiteItem.className = constants.CLASS_DROPDOWN_ITEM
        disableSiteItem.type = "button"
        disableSiteItem.textContent = i18nModule.translate("popup.floatingButton.disableSite")
        disableSiteItem.addEventListener("mousedown", (e) => e.stopPropagation())
        disableSiteItem.addEventListener("click", async () => {
            const hostname = window.location.hostname
            await this.configStore.addDisabledSite(hostname)
            logger.info(`Disabled for site: ${hostname}`)
            this.close()
            this.onDisable()
        })

        // "Disable globally" item
        const disableGloballyItem = document.createElement("button")
        disableGloballyItem.className = constants.CLASS_DROPDOWN_ITEM
        disableGloballyItem.type = "button"
        disableGloballyItem.textContent = i18nModule.translate("popup.floatingButton.disableGlobally")
        disableGloballyItem.addEventListener("mousedown", (e) => e.stopPropagation())
        disableGloballyItem.addEventListener("click", async () => {
            await this.configStore.setEnabled(false)
            logger.info("Disabled globally")
            this.close()
            this.onDisable()
        })

        this.dropdown.appendChild(disableSiteItem)
        this.dropdown.appendChild(disableGloballyItem)
    }

    private handleCloseButtonClick(e: MouseEvent): void {
        e.stopPropagation()
        if (this.isOpen) {
            this.close()
        } else {
            this.open()
        }
    }

    private open(): void {
        this.isOpen = true
        this.dropdown.classList.add(`${constants.CSS_PREFIX}-visible`)
        this.onVisibilityChange(true)

        // Close on clicking outside
        this.boundDocumentClick = (e: MouseEvent) => {
            const target = e.target as Node
            if (!this.dropdown.contains(target) && !this.closeButton.contains(target)) {
                this.close()
            }
        }
        // Use setTimeout to avoid the current click event from immediately closing
        setTimeout(() => {
            document.addEventListener("click", this.boundDocumentClick!)
        }, 0)

        logger.info("Dropdown opened")
    }

    private close(): void {
        this.isOpen = false
        this.dropdown.classList.remove(`${constants.CSS_PREFIX}-visible`)
        this.onVisibilityChange(false)
        this.removeDocumentListener()
        logger.info("Dropdown closed")
    }

    private removeDocumentListener(): void {
        if (this.boundDocumentClick) {
            document.removeEventListener("click", this.boundDocumentClick)
            this.boundDocumentClick = null
        }
    }
}
