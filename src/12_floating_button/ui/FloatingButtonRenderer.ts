/**
 * FloatingButtonRenderer — DOM creation, style injection, and visual state management.
 * Builds the floating button UI as plain DOM elements with inline SVG icons.
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as commonConstants from "@/0_common/constants"
import type { FloatingButtonState, IconVariant } from "@/12_floating_button/types"
import * as constants from "@/12_floating_button/constants"
import { FLOATING_BUTTON_STYLES } from "@/12_floating_button/ui/styles"
import { ICON_VARIANTS } from "@/12_floating_button/ui/iconVariants"

const logger = loggerModule.createLogger("FloatingButtonRenderer")

// --- Inline SVG Icons ---

/** Checkmark icon for active badge */
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12l5 5L20 7"/>
</svg>`

/** Warning "!" icon for exhausted badge */
const EXHAUSTED_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6" cy="6" r="6" fill="${constants.BADGE_COLOR_EXHAUSTED}"/>
    <text x="6" y="9" text-anchor="middle" font-size="8" font-weight="bold" fill="white">!</text>
</svg>`

/** X icon for close button */
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 6L6 18"/>
    <path d="M6 6l12 12"/>
</svg>`

export class FloatingButtonRenderer {
    private container: HTMLDivElement | null = null
    private mainButton: HTMLDivElement | null = null
    private closeButton: HTMLButtonElement | null = null
    private activeBadge: HTMLDivElement | null = null
    private exhaustedBadge: HTMLDivElement | null = null
    private spinner: HTMLDivElement | null = null
    private dropdown: HTMLDivElement | null = null
    private styleElement: HTMLStyleElement | null = null
    private currentState: FloatingButtonState = "idle"

    /**
     * Build the full DOM tree and inject styles.
     * @param iconVariant — which icon design to render (default 'v1')
     * @param iconColor — brand color hex for the icon
     * Returns the container element to be appended to document.body.
     */
    create(iconVariant: IconVariant = "v1", iconColor: string): HTMLDivElement {
        this.injectStyles()

        // Container
        const container = document.createElement("div")
        container.className = constants.CLASS_CONTAINER
        container.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, "")

        // Main button
        const mainButton = document.createElement("div")
        mainButton.className = constants.CLASS_MAIN_BUTTON
        mainButton.innerHTML = ICON_VARIANTS[iconVariant](iconColor)

        // Close button
        const closeButton = document.createElement("button")
        closeButton.className = constants.CLASS_CLOSE_BUTTON
        closeButton.type = "button"
        closeButton.title = "Close floating button"
        closeButton.innerHTML = CLOSE_ICON_SVG
        mainButton.appendChild(closeButton)

        // Active badge (green checkmark)
        const activeBadge = document.createElement("div")
        activeBadge.className = constants.CLASS_ACTIVE_BADGE
        activeBadge.innerHTML = CHECK_ICON_SVG
        mainButton.appendChild(activeBadge)

        // Exhausted badge (gray warning "!")
        const exhaustedBadge = document.createElement("div")
        exhaustedBadge.className = constants.CLASS_EXHAUSTED_BADGE
        exhaustedBadge.innerHTML = EXHAUSTED_ICON_SVG
        mainButton.appendChild(exhaustedBadge)

        // Spinner (for translating state)
        const spinner = document.createElement("div")
        spinner.className = constants.CLASS_SPINNER
        mainButton.appendChild(spinner)

        // Dropdown menu (initially hidden, positioned left of main button)
        const dropdown = document.createElement("div")
        dropdown.className = constants.CLASS_DROPDOWN
        mainButton.appendChild(dropdown)

        container.appendChild(mainButton)

        this.container = container
        this.mainButton = mainButton
        this.closeButton = closeButton
        this.activeBadge = activeBadge
        this.exhaustedBadge = exhaustedBadge
        this.spinner = spinner
        this.dropdown = dropdown

        logger.info("Floating button DOM created")
        return container
    }

    /** Remove all DOM elements and the injected style tag */
    destroy(): void {
        this.styleElement?.remove()
        this.container?.remove()

        this.container = null
        this.mainButton = null
        this.closeButton = null
        this.activeBadge = null
        this.exhaustedBadge = null
        this.spinner = null
        this.dropdown = null
        this.styleElement = null

        logger.info("Floating button DOM destroyed")
    }

    /** Update visual state: idle, translating, active, or quota_exhausted */
    setTranslationState(state: FloatingButtonState): void {
        if (state === this.currentState) return
        this.currentState = state

        const badgeVisible = `${constants.CSS_PREFIX}-visible`

        switch (state) {
            case "idle":
                this.activeBadge?.classList.remove(badgeVisible)
                this.exhaustedBadge?.classList.remove(badgeVisible)
                this.spinner?.classList.remove(badgeVisible)
                break
            case "translating":
                this.activeBadge?.classList.remove(badgeVisible)
                this.exhaustedBadge?.classList.remove(badgeVisible)
                this.spinner?.classList.add(badgeVisible)
                break
            case "active":
                this.spinner?.classList.remove(badgeVisible)
                this.exhaustedBadge?.classList.remove(badgeVisible)
                this.activeBadge?.classList.add(badgeVisible)
                break
            case "quota_exhausted":
                this.spinner?.classList.remove(badgeVisible)
                this.activeBadge?.classList.remove(badgeVisible)
                this.exhaustedBadge?.classList.add(badgeVisible)
                break
        }

        logger.info(`Visual state changed to: ${state}`)
    }

    /** Update the button's vertical position using a 0-1 viewport ratio */
    setPosition(ratio: number): void {
        if (!this.container) return
        const clampedRatio = Math.max(0, Math.min(1, ratio))
        this.container.style.top = `${clampedRatio * 100}vh`
    }

    /** Show the container */
    show(): void {
        if (this.container) {
            this.container.style.display = ""
        }
    }

    /** Hide the container */
    hide(): void {
        if (this.container) {
            this.container.style.display = "none"
        }
    }

    /** Get the main button element (used by DragHandler) */
    getMainButton(): HTMLDivElement | null {
        return this.mainButton
    }

    /** Get the close button element (used by CloseMenuHandler) */
    getCloseButton(): HTMLButtonElement | null {
        return this.closeButton
    }

    /** Get the dropdown element (used by CloseMenuHandler) */
    getDropdown(): HTMLDivElement | null {
        return this.dropdown
    }

    /** Get the container element */
    getContainer(): HTMLDivElement | null {
        return this.container
    }

    /** Slide the button to the right out of viewport, then hide */
    slideOutAndHide(): void {
        if (!this.container) return
        this.container.classList.add(constants.CLASS_SLIDING_OUT)
        setTimeout(() => {
            this.hide()
            this.container?.classList.remove(constants.CLASS_SLIDING_OUT)
        }, constants.SLIDE_OUT_DURATION_MS)
    }

    /** Set dragging visual state */
    setDragging(isDragging: boolean): void {
        const draggingClass = `${constants.CSS_PREFIX}-dragging`
        if (isDragging) {
            this.mainButton?.classList.add(draggingClass)
        } else {
            this.mainButton?.classList.remove(draggingClass)
        }
    }

    /** Set expanded visual state (used when dropdown is open) */
    setExpanded(isExpanded: boolean): void {
        const expandedClass = `${constants.CSS_PREFIX}-expanded`
        if (isExpanded) {
            this.mainButton?.classList.add(expandedClass)
        } else {
            this.mainButton?.classList.remove(expandedClass)
        }
    }

    /** Inject the <style> tag into the document head */
    private injectStyles(): void {
        if (this.styleElement) return

        const style = document.createElement("style")
        style.id = constants.CLASS_STYLE_TAG
        style.textContent = FLOATING_BUTTON_STYLES
        document.head.appendChild(style)
        this.styleElement = style
    }
}
