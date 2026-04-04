/**
 * FloatingButtonConfigStore — reads/writes floating button configuration
 * from chrome.storage.local and listens for cross-context changes.
 */

import * as loggerModule from '@/0_common/utils/logger';
import type { FloatingButtonConfig, ConfigChangeCallback } from '@/12_floating_button/types';
import { FLOATING_BUTTON_STORAGE_KEY, DEFAULT_CONFIG } from '@/12_floating_button/constants';

const logger = loggerModule.createLogger('FloatingButtonConfigStore');

export class FloatingButtonConfigStore {
    private config: FloatingButtonConfig = { ...DEFAULT_CONFIG };
    private changeListeners: ConfigChangeCallback[] = [];
    private storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null;

    /** Load config from chrome.storage.local. Falls back to defaults on error. */
    async load(): Promise<FloatingButtonConfig> {
        try {
            const result = await chrome.storage.local.get(FLOATING_BUTTON_STORAGE_KEY);
            const stored = result[FLOATING_BUTTON_STORAGE_KEY] as Partial<FloatingButtonConfig> | undefined;
            this.config = { ...DEFAULT_CONFIG, ...stored };
            logger.info('Config loaded:', this.config);
        } catch (error) {
            logger.error('Failed to load config, using defaults:', error);
            this.config = { ...DEFAULT_CONFIG };
        }
        return { ...this.config };
    }

    /** Persist a partial config update to chrome.storage.local */
    async save(partial: Partial<FloatingButtonConfig>): Promise<void> {
        this.config = { ...this.config, ...partial };
        try {
            await chrome.storage.local.set({ [FLOATING_BUTTON_STORAGE_KEY]: this.config });
            logger.info('Config saved:', this.config);
        } catch (error) {
            logger.error('Failed to save config:', error);
        }
    }

    /** Add the current hostname to the disabled sites list */
    async addDisabledSite(hostname: string): Promise<void> {
        if (this.config.disabledSites.includes(hostname)) return;
        const updatedSites = [...this.config.disabledSites, hostname];
        await this.save({ disabledSites: updatedSites });
    }

    /** Update the global enabled flag */
    async setEnabled(enabled: boolean): Promise<void> {
        await this.save({ enabled });
    }

    /** Update the vertical position ratio */
    async setPosition(position: number): Promise<void> {
        await this.save({ position });
    }

    /** Check if the button is disabled for a given hostname */
    isDisabledForSite(hostname: string): boolean {
        return this.config.disabledSites.some(
            pattern => hostname === pattern || hostname.endsWith(`.${pattern}`)
        );
    }

    /** Get the current config snapshot */
    getConfig(): FloatingButtonConfig {
        return { ...this.config };
    }

    /**
     * Register a listener for cross-context config changes
     * (e.g., popup or options page updating the config).
     */
    onChanged(callback: ConfigChangeCallback): void {
        this.changeListeners.push(callback);

        // Set up the chrome.storage.onChanged listener once
        if (!this.storageListener) {
            this.storageListener = (changes, areaName) => {
                if (areaName !== 'local' || !changes[FLOATING_BUTTON_STORAGE_KEY]) return;

                const newConfig = changes[FLOATING_BUTTON_STORAGE_KEY].newValue as FloatingButtonConfig | undefined;
                if (!newConfig) return;

                this.config = { ...DEFAULT_CONFIG, ...newConfig };
                logger.info('Config changed externally:', this.config);

                for (const listener of this.changeListeners) {
                    listener({ ...this.config });
                }
            };
            try {
                chrome.storage.onChanged.addListener(this.storageListener);
            } catch {
                // Extension context may be invalidated
            }
        }
    }

    /** Remove all listeners and clean up */
    destroy(): void {
        if (this.storageListener) {
            try {
                chrome.storage?.onChanged?.removeListener(this.storageListener);
            } catch {
                // Extension context may be invalidated
            }
            this.storageListener = null;
        }
        this.changeListeners = [];
    }
}
