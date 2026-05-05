/**
 * FloatingButtonManager — top-level orchestrator for the floating button.
 * Coordinates config, rendering, drag, close menu, and translation state.
 */

import * as loggerModule from '@/0_common/utils/logger';
import type { FloatingButtonConfig, FloatingButtonState, IconVariant } from '@/12_floating_button/types';
import { FloatingButtonRenderer } from '@/12_floating_button/ui/FloatingButtonRenderer';
import { FloatingButtonConfigStore } from '@/12_floating_button/config/FloatingButtonConfigStore';
import { DEFAULT_ICON_COLOR, AUTO_HIDE_DELAY_MS } from '@/12_floating_button/constants';
import { DragHandler } from '@/12_floating_button/handlers/DragHandler';

const logger = loggerModule.createLogger('FloatingButtonManager');

export class FloatingButtonManager {
    private renderer: FloatingButtonRenderer;
    private configStore: FloatingButtonConfigStore;
    private dragHandler: DragHandler | null = null;
    private isInitialized = false;
    private currentIconVariant: IconVariant | null = null;
    private currentIconColor: string | null = null;
    private currentState: FloatingButtonState = 'idle';
    private autoHideTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

        // Skip non-renderable contexts (non-HTTP pages, site disabled)
        if (!this.isRenderableContext()) {
            logger.info('Floating button not renderable in this context');
            return;
        }

        // Create DOM — initially hidden to prevent flash before config is applied
        const iconColor = config.iconColor ?? DEFAULT_ICON_COLOR;
        const container = this.renderer.create(config.iconVariant, iconColor);
        this.renderer.hide();
        this.renderer.setPosition(config.position);
        this.currentIconVariant = config.iconVariant;
        this.currentIconColor = iconColor;
        document.body.appendChild(container);

        // Show only if globally enabled
        if (config.enabled) {
            this.renderer.show();
        } else {
            logger.info('Floating button created but hidden (disabled)');
        }

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

        // Listen for cross-context config changes (popup, options page)
        this.configStore.onChanged((updatedConfig) => {
            this.handleConfigChanged(updatedConfig);
        });

        this.isInitialized = true;
        logger.info('Floating button initialized');
    }

    /** Update the visual state to reflect translation progress */
    setTranslationState(state: FloatingButtonState): void {
        this.clearAutoHideTimeout();
        this.currentState = state;
        this.renderer.setTranslationState(state);

        // Schedule auto-hide when quota is exhausted and user opted in
        if (state === 'quota_exhausted' && this.configStore.getConfig().autoHideOnQuotaExhausted) {
            this.autoHideTimeoutId = setTimeout(() => {
                this.renderer.slideOutAndHide();
                logger.info('Button auto-hidden due to quota exhaustion');
            }, AUTO_HIDE_DELAY_MS);
        }
    }

    /** Hide the button immediately without animation or delay */
    hideImmediately(): void {
        this.clearAutoHideTimeout();
        this.currentState = 'quota_exhausted';
        this.renderer.hide();
        logger.info('Button hidden immediately');
    }

    /** Clean up all resources */
    destroy(): void {
        this.clearAutoHideTimeout();
        this.dragHandler?.detach();
        this.configStore.destroy();
        this.renderer.destroy();

        this.dragHandler = null;
        this.onToggleTranslation = null;
        this.isInitialized = false;

        logger.info('Floating button destroyed');
    }

    /** Check if the button is currently rendered and visible */
    isActive(): boolean {
        return this.isInitialized;
    }

    /** Get the current translation state */
    getCurrentState(): FloatingButtonState {
        return this.currentState;
    }

    /** Get a snapshot of the current config */
    getCurrentConfig(): FloatingButtonConfig {
        return this.configStore.getConfig();
    }

    /** Clear the auto-hide timeout if one is pending */
    private clearAutoHideTimeout(): void {
        if (this.autoHideTimeoutId !== null) {
            clearTimeout(this.autoHideTimeoutId);
            this.autoHideTimeoutId = null;
        }
    }

    /** Check if the page context allows rendering (ignores enabled flag) */
    private isRenderableContext(): boolean {
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

    /** Handle config changes from other extension contexts */
    private handleConfigChanged(config: FloatingButtonConfig): void {
        if (!config.enabled) {
            this.renderer.hide();
            logger.info('Button hidden due to config change (disabled)');
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

        logger.info(`Button recreated with icon variant: ${config.iconVariant}`);
    }
}
