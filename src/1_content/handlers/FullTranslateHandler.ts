/**
 * FullTranslateHandler — manages the PageTranslationManager lifecycle
 * in the content script. Lazily creates the manager on first toggle.
 */

import * as loggerModule from '@/0_common/utils/logger';
import * as storageManager from '@/0_common/utils/storageManager';
import * as i18nModule from '@/0_common/utils/i18n';
import { isDarkThemeContext } from '@/1_content/utils/styleCalculator/dom';
import type {
    FullTranslateStatusResponseMessage,
    FullTranslateToggleResponseMessage,
} from '@/0_common/types';
import * as toastNotification from '@/1_content/ui/toast/toastNotification';
import { PageTranslationManager } from '@/11_full_translate/PageTranslationManager';
import type { FullTranslateConfig } from '@/11_full_translate/types';
import {
    DEFAULT_PRELOAD_MARGIN,
    DEFAULT_PRELOAD_THRESHOLD,
    DEFAULT_MIN_CHARS_PER_NODE,
    DEFAULT_MIN_WORDS_PER_NODE,
} from '@/11_full_translate/constants';

const logger = loggerModule.createLogger('Content/FullTranslateHandler');

// --- Event system for external observers (e.g., floating button) ---

/** Lifecycle events emitted during translation state transitions */
export type FullTranslateEvent = 'starting' | 'started' | 'stopped' | 'error' | 'quota_exhausted';
export type FullTranslateEventListener = (event: FullTranslateEvent) => void;

const eventListeners = new Set<FullTranslateEventListener>();

/** Register a listener for translation lifecycle events */
export function addEventListener(listener: FullTranslateEventListener): void {
    eventListeners.add(listener);
}

/** Unregister a lifecycle event listener */
export function removeEventListener(listener: FullTranslateEventListener): void {
    eventListeners.delete(listener);
}

function emitEvent(event: FullTranslateEvent): void {
    for (const listener of eventListeners) {
        try {
            listener(event);
        } catch (e) {
            logger.error('Event listener error:', e);
        }
    }
}

const DEFAULT_SOURCE_LANG = 'auto';
const DEFAULT_TARGET_LANG = 'zh';
const DEFAULT_MODE = 'bilingual' as const;
// Development-stage product decision:
// keep the "main" path available in the module, but force the live entrypoint
// to use true full-page coverage until range switching is exposed intentionally.
const DEFAULT_RANGE = 'all' as const;

let manager: PageTranslationManager | null = null;

/** Check if full-text translation is currently running */
export function getIsRunning(): boolean {
    return manager?.getIsRunning() ?? false;
}

// --- Core start/stop logic (shared by message handler and direct toggle) ---

async function startTranslation(): Promise<void> {
    // Proactive quota check before starting translation (only for official provider)
    try {
        const response = await chrome.runtime.sendMessage({ type: 'QUOTA_USAGE_REQUEST' });
        if (response?.success && response.data?.fullTextTranslation) {
            const isOfficialProvider = response.data.isOfficialProvider !== false;
            const quota = response.data.fullTextTranslation;
            if (isOfficialProvider && quota.remaining <= 0) {
                const message = i18nModule.translate('fullTranslate.quotaExhausted.toast');
                toastNotification.showViewportToast(message, 'info');
                emitEvent('quota_exhausted');
                return;
            }
        }
    } catch (error) {
        logger.warn('Failed to check quota before translation, proceeding anyway', error);
    }

    emitEvent('starting');
    const config = await buildConfig();
    if (!manager) {
        manager = new PageTranslationManager(config);
    } else {
        await manager.updateConfig(config);
    }
    manager.onQuotaExhausted = () => {
        manager?.pause();
        const message = i18nModule.translate('fullTranslate.quotaExhausted.toast');
        toastNotification.showViewportToast(message, 'info');
        emitEvent('quota_exhausted');
    };
    await manager.start();
    logger.info('Full-page translation started');
    emitEvent('started');
}

function stopTranslation(): void {
    if (manager) {
        manager.stop();
        logger.info('Full-page translation stopped');
    }
    emitEvent('stopped');
}

/**
 * Toggle translation directly (for in-page callers like the floating button).
 * @returns the new isRunning state
 */
export async function toggle(): Promise<boolean> {
    try {
        if (getIsRunning()) {
            stopTranslation();
            return false;
        } else {
            await startTranslation();
            return true;
        }
    } catch (error) {
        logger.error('Failed to toggle full-page translation:', error);
        emitEvent('error');
        return getIsRunning();
    }
}

/**
 * Handle the full-translate toggle message from popup/background.
 * Lazily creates the PageTranslationManager on first use.
 */
export async function handleToggle(
    enabled: boolean,
    sendResponse: (response: FullTranslateToggleResponseMessage) => void,
): Promise<void> {
    try {
        if (enabled) {
            if (manager?.getIsRunning()) {
                sendResponse({ success: true, isRunning: true });
                return;
            }
            await startTranslation();
            sendResponse({ success: true, isRunning: true });
        } else {
            stopTranslation();
            sendResponse({ success: true, isRunning: false });
        }
    } catch (error) {
        logger.error('Failed to toggle full-page translation:', error);
        emitEvent('error');
        sendResponse({
            success: false,
            isRunning: manager?.getIsRunning() ?? false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export function handleStatusRequest(
    sendResponse: (response: FullTranslateStatusResponseMessage) => void,
): void {
    sendResponse({
        success: true,
        isRunning: manager?.getIsRunning() ?? false,
    });
}

/**
 * Build FullTranslateConfig from user settings.
 */
async function buildConfig(): Promise<FullTranslateConfig> {
    const settings = await storageManager.getUserSettings();
    const isDark = isDarkThemeContext();
    const translationTextColor = isDark
        ? (settings.fullTranslateDarkColor ?? '#ffffff')
        : (settings.fullTranslateLightColor ?? '#000000');

    return {
        mode: DEFAULT_MODE,
        range: DEFAULT_RANGE,
        preload: {
            margin: DEFAULT_PRELOAD_MARGIN,
            threshold: DEFAULT_PRELOAD_THRESHOLD,
        },
        minCharactersPerNode: DEFAULT_MIN_CHARS_PER_NODE,
        minWordsPerNode: DEFAULT_MIN_WORDS_PER_NODE,
        sourceLang: DEFAULT_SOURCE_LANG,
        targetLang: settings.targetLanguage || DEFAULT_TARGET_LANG,
        translationTextColor,
    };
}
