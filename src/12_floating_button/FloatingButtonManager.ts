/**
 * FloatingButtonManager — top-level orchestrator for the floating button.
 * Coordinates config, rendering, drag, close menu, and translation state.
 */

import * as loggerModule from '@/0_common/utils/logger';
import type { FloatingButtonConfig, FloatingButtonState, IconVariant } from '@/12_floating_button/types';
import { FloatingButtonRenderer } from '@/12_floating_button/ui/FloatingButtonRenderer';
import { FloatingButtonConfigStore } from '@/12_floating_button/config/FloatingButtonConfigStore';
import { DEFAULT_ICON_COLOR } from '@/12_floating_button/constants';
import { DragHandler } from '@/12_floating_button/handlers/DragHandler';
import { CloseMenuHandler } from '@/12_floating_button/handlers/CloseMenuHandler';

const logger = loggerModule.createLogger('FloatingButtonManager');

export class FloatingButtonManager {
    private renderer: FloatingButtonRenderer;
    private configStore: FloatingButtonConfigStore;
    private dragHandler: DragHandler | null = null;
    private closeMenuHandler: CloseMenuHandler | null = null;
    private isInitialized = false;
    private currentIconVariant: IconVariant | null = null;
    private currentIconColor: string | null = null;

    /** Callback invoked when the user clicks the button to toggle translation */
    private onToggleTranslation: (() => void) | null = null;

    constructor() {
        this.renderer = new FloatingButtonRenderer();
        this.configStore = new FloatingButtonConfigStore();
    }

    /**
     * Initialize the floating button: load config, check visibility,
     * create DOM, attach handlers, and set up cross-context sync.
     * @param onToggleTranslation — called when user clicks the button
     */
    async initialize(onToggleTranslation: () => void): Promise<void> {
        if (this.isInitialized) {
            logger.warn('Already initialized');
            return;
        }

        this.onToggleTranslation = onToggleTranslation;

        // Load persisted config
        const config = await this.configStore.load();

        // Check if we should render on this page
        if (!this.shouldRender(config)) {
            logger.info('Floating button disabled for this context');
            return;
        }

        // Create DOM and attach to body
        const iconColor = config.iconColor ?? DEFAULT_ICON_COLOR;
        const container = this.renderer.create(config.iconVariant, iconColor);
        this.renderer.setPosition(config.position);
        this.currentIconVariant = config.iconVariant;
        this.currentIconColor = iconColor;
        document.body.appendChild(container);

        // Set up drag handler
        const mainButton = this.renderer.getMainButton();
        if (mainButton) {
            this.dragHandler = new DragHandler(
                mainButton,
                (ratio) => this.renderer.setPosition(ratio),
                (ratio) => this.handleDragEnd(ratio),
                () => this.handleClick(),
                () => this.renderer.setDragging(true),
            );
            this.dragHandler.attach();
        }

        // Set up close menu handler
        const closeButton = this.renderer.getCloseButton();
        const dropdown = this.renderer.getDropdown();
        if (closeButton && dropdown) {
            this.closeMenuHandler = new CloseMenuHandler(
                closeButton,
                dropdown,
                this.configStore,
                (isOpen) => this.renderer.setExpanded(isOpen),
                () => this.handleDisable(),
            );
            this.closeMenuHandler.attach();
        }

        // Listen for cross-context config changes (popup, options page)
        this.configStore.onChanged((updatedConfig) => {
            this.handleConfigChanged(updatedConfig);
        });

        this.isInitialized = true;
        logger.info('Floating button initialized');
    }

    /** Update the visual state to reflect translation progress */
    setTranslationState(state: FloatingButtonState): void {
        this.renderer.setTranslationState(state);
    }

    /** Clean up all resources */
    destroy(): void {
        this.dragHandler?.detach();
        this.closeMenuHandler?.detach();
        this.configStore.destroy();
        this.renderer.destroy();

        this.dragHandler = null;
        this.closeMenuHandler = null;
        this.onToggleTranslation = null;
        this.isInitialized = false;

        logger.info('Floating button destroyed');
    }

    /** Check if the button is currently rendered and visible */
    isActive(): boolean {
        return this.isInitialized;
    }

    /** Determine if the button should render based on config and page context */
    private shouldRender(config: FloatingButtonConfig): boolean {
        // Globally disabled
        if (!config.enabled) return false;

        // Not on HTTP/HTTPS pages
        if (!window.location.protocol.startsWith('http')) return false;

        // Disabled for current site
        if (this.configStore.isDisabledForSite(window.location.hostname)) return false;

        return true;
    }

    /** Handle button click — toggle translation */
    private handleClick(): void {
        logger.info('Button clicked, toggling translation');
        this.onToggleTranslation?.();
    }

    /** Handle drag end — persist the new position */
    private async handleDragEnd(ratio: number): Promise<void> {
        this.renderer.setDragging(false);
        this.renderer.setPosition(ratio);
        await this.configStore.setPosition(ratio);
        logger.info(`Position persisted: ${ratio.toFixed(3)}`);
    }

    /** Handle disable action from the dropdown */
    private handleDisable(): void {
        this.renderer.hide();
        logger.info('Button hidden via disable action');
    }

    /** Handle config changes from other extension contexts */
    private handleConfigChanged(config: FloatingButtonConfig): void {
        if (!this.shouldRender(config)) {
            this.renderer.hide();
            logger.info('Button hidden due to config change');
            return;
        }

        // Recreate button when icon variant or color changes
        const newIconColor = config.iconColor ?? DEFAULT_ICON_COLOR;
        if (config.iconVariant !== this.currentIconVariant || newIconColor !== this.currentIconColor) {
            this.recreateButton(config);
            return;
        }

        this.renderer.setPosition(config.position);
        this.renderer.show();
    }

    /** Destroy and recreate the button DOM with updated config */
    private recreateButton(config: FloatingButtonConfig): void {
        this.dragHandler?.detach();
        this.closeMenuHandler?.detach();
        this.renderer.destroy();

        const iconColor = config.iconColor ?? DEFAULT_ICON_COLOR;
        const container = this.renderer.create(config.iconVariant, iconColor);
        this.renderer.setPosition(config.position);
        this.currentIconVariant = config.iconVariant;
        this.currentIconColor = iconColor;
        document.body.appendChild(container);

        // Re-attach drag handler
        const mainButton = this.renderer.getMainButton();
        if (mainButton) {
            this.dragHandler = new DragHandler(
                mainButton,
                (ratio) => this.renderer.setPosition(ratio),
                (ratio) => this.handleDragEnd(ratio),
                () => this.handleClick(),
                () => this.renderer.setDragging(true),
            );
            this.dragHandler.attach();
        }

        // Re-attach close menu handler
        const closeButton = this.renderer.getCloseButton();
        const dropdown = this.renderer.getDropdown();
        if (closeButton && dropdown) {
            this.closeMenuHandler = new CloseMenuHandler(
                closeButton,
                dropdown,
                this.configStore,
                (isOpen) => this.renderer.setExpanded(isOpen),
                () => this.handleDisable(),
            );
            this.closeMenuHandler.attach();
        }

        logger.info(`Button recreated with icon variant: ${config.iconVariant}`);
    }
}
