/**
 * FullTranslateHandler — manages the PageTranslationManager lifecycle
 * in the content script. Lazily creates the manager on first toggle.
 */

import * as loggerModule from '@/0_common/utils/logger';
import * as storageManager from '@/0_common/utils/storageManager';
import type {
    FullTranslateStatusResponseMessage,
    FullTranslateToggleResponseMessage,
} from '@/0_common/types';
import { PageTranslationManager } from '@/11_full_translate/PageTranslationManager';
import type { FullTranslateConfig } from '@/11_full_translate/types';
import {
    DEFAULT_PRELOAD_MARGIN,
    DEFAULT_PRELOAD_THRESHOLD,
    DEFAULT_MIN_CHARS_PER_NODE,
    DEFAULT_MIN_WORDS_PER_NODE,
} from '@/11_full_translate/constants';

const logger = loggerModule.createLogger('Content/FullTranslateHandler');

const DEFAULT_SOURCE_LANG = 'auto';
const DEFAULT_TARGET_LANG = 'zh';
const DEFAULT_MODE = 'bilingual' as const;
// Development-stage product decision:
// keep the "main" path available in the module, but force the live entrypoint
// to use true full-page coverage until range switching is exposed intentionally.
const DEFAULT_RANGE = 'all' as const;

let manager: PageTranslationManager | null = null;

/**
 * Handle the full-translate toggle message.
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

            const config = await buildConfig();

            if (!manager) {
                manager = new PageTranslationManager(config);
            } else {
                await manager.updateConfig(config);
            }

            await manager.start();
            logger.info('Full-page translation started');
            sendResponse({ success: true, isRunning: true });
        } else {
            if (manager) {
                manager.stop();
                logger.info('Full-page translation stopped');
            }
            sendResponse({ success: true, isRunning: false });
        }
    } catch (error) {
        logger.error('Failed to toggle full-page translation:', error);
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
    };
}
