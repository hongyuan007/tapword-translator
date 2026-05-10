/**
 * FloatingButtonRenderer — DOM creation, style injection, and visual state management.
 * Builds the floating button UI as plain DOM elements with inline SVG icons.
 */

import * as loggerModule from '@/0_common/utils/logger';
import * as commonConstants from '@/0_common/constants';
import type { FloatingButtonState, IconVariant } from '@/12_floating_button/types';
import * as constants from '@/12_floating_button/constants';
import { FLOATING_BUTTON_STYLES } from '@/12_floating_button/ui/styles';
import { ICON_VARIANTS } from '@/12_floating_button/ui/iconVariants';

const logger = loggerModule.createLogger('FloatingButtonRenderer');

// --- Inline SVG Icons ---

/** Checkmark icon for active badge */
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12l5 5L20 7"/>
</svg>`;

/** Warning "!" icon for exhausted badge */
const EXHAUSTED_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6" cy="6" r="6" fill="${constants.BADGE_COLOR_EXHAUSTED}"/>
    <text x="6" y="9" text-anchor="middle" font-size="8" font-weight="bold" fill="white">!</text>
</svg>`;

export class FloatingButtonRenderer {
    private container: HTMLDivElement | null = null;
    private mainButton: HTMLDivElement | null = null;
    private activeBadge: HTMLDivElement | null = null;
    private exhaustedBadge: HTMLDivElement | null = null;
    private spinner: HTMLDivElement | null = null;
    private styleElement: HTMLStyleElement | null = null;
    private currentState: FloatingButtonState = 'idle';

    /**
     * Build the full DOM tree and inject styles.
     * @param iconVariant — which icon design to render (default 'v1')
     * @param iconColor — brand color hex for the icon
     * Returns the container element to be appended to document.body.
     */
    create(iconVariant: IconVariant = 'v1', iconColor: string): HTMLDivElement {
        this.injectStyles();

        // Container
        const container = document.createElement('div');
        container.className = constants.CLASS_CONTAINER;
        container.setAttribute(commonConstants.EXTENSION_OWNED_ATTRIBUTE, '');

        // Main button
        const mainButton = document.createElement('div');
        mainButton.className = constants.CLASS_MAIN_BUTTON;
        mainButton.innerHTML = ICON_VARIANTS[iconVariant](iconColor);

        // Active badge (green checkmark)
        const activeBadge = document.createElement('div');
        activeBadge.className = constants.CLASS_ACTIVE_BADGE;
        activeBadge.innerHTML = CHECK_ICON_SVG;
        mainButton.appendChild(activeBadge);

        // Exhausted badge (gray warning "!")
        const exhaustedBadge = document.createElement('div');
        exhaustedBadge.className = constants.CLASS_EXHAUSTED_BADGE;
        exhaustedBadge.innerHTML = EXHAUSTED_ICON_SVG;
        mainButton.appendChild(exhaustedBadge);

        // Spinner (for translating state)
        const spinner = document.createElement('div');
        spinner.className = constants.CLASS_SPINNER;
        mainButton.appendChild(spinner);

        container.appendChild(mainButton);

        this.container = container;
        this.mainButton = mainButton;
        this.activeBadge = activeBadge;
        this.exhaustedBadge = exhaustedBadge;
        this.spinner = spinner;

        logger.info('Floating button DOM created');
        return container;
    }

    /** Remove all DOM elements and the injected style tag */
    destroy(): void {
        this.styleElement?.remove();
        this.container?.remove();

        this.container = null;
        this.mainButton = null;
        this.activeBadge = null;
        this.exhaustedBadge = null;
        this.spinner = null;
        this.styleElement = null;

        logger.info('Floating button DOM destroyed');
    }

    /** Update visual state: idle, translating, active, or quota_exhausted */
    setTranslationState(state: FloatingButtonState): void {
        if (state === this.currentState) return;
        this.currentState = state;

        const badgeVisible = `${constants.CSS_PREFIX}-visible`;
        const translationActive = constants.CLASS_TRANSLATION_ACTIVE;

        switch (state) {
            case 'idle':
                this.activeBadge?.classList.remove(badgeVisible);
                this.exhaustedBadge?.classList.remove(badgeVisible);
                this.spinner?.classList.remove(badgeVisible);
                this.mainButton?.classList.remove(translationActive);
                break;
            case 'translating':
                this.activeBadge?.classList.remove(badgeVisible);
                this.exhaustedBadge?.classList.remove(badgeVisible);
                this.spinner?.classList.add(badgeVisible);
                this.mainButton?.classList.add(translationActive);
                break;
            case 'active':
                this.spinner?.classList.remove(badgeVisible);
                this.exhaustedBadge?.classList.remove(badgeVisible);
                this.activeBadge?.classList.add(badgeVisible);
                this.mainButton?.classList.add(translationActive);
                break;
            case 'quota_exhausted':
                this.spinner?.classList.remove(badgeVisible);
                this.activeBadge?.classList.remove(badgeVisible);
                this.exhaustedBadge?.classList.add(badgeVisible);
                this.mainButton?.classList.remove(translationActive);
                break;
        }

        logger.info(`Visual state changed to: ${state}`);
    }

    /** Update the button's vertical position using a 0-1 viewport ratio */
    setPosition(ratio: number): void {
        if (!this.container) return;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        this.container.style.top = `${clampedRatio * 100}vh`;
    }

    /** Show the container */
    show(): void {
        if (this.container) {
            this.container.style.display = '';
        }
    }

    /** Hide the container */
    hide(): void {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    /** Get the main button element (used by DragHandler) */
    getMainButton(): HTMLDivElement | null {
        return this.mainButton;
    }

    /** Get the container element */
    getContainer(): HTMLDivElement | null {
        return this.container;
    }

    /** Set dragging visual state */
    setDragging(isDragging: boolean): void {
        const draggingClass = `${constants.CSS_PREFIX}-dragging`;
        if (isDragging) {
            this.mainButton?.classList.add(draggingClass);
        } else {
            this.mainButton?.classList.remove(draggingClass);
        }
    }

    /** Set expanded visual state (used when dropdown is open) */
    setExpanded(isExpanded: boolean): void {
        const expandedClass = `${constants.CSS_PREFIX}-expanded`;
        if (isExpanded) {
            this.mainButton?.classList.add(expandedClass);
        } else {
            this.mainButton?.classList.remove(expandedClass);
        }
    }

    /** Inject the <style> tag into the document head */
    private injectStyles(): void {
        if (this.styleElement) return;

        const style = document.createElement('style');
        style.id = constants.CLASS_STYLE_TAG;
        style.textContent = FLOATING_BUTTON_STYLES;
        document.head.appendChild(style);
        this.styleElement = style;
    }
}
