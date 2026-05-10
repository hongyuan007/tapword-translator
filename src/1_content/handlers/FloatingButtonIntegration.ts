/**
 * FloatingButtonIntegration — connects the FloatingButtonManager
 * to the full-text translation flow managed by FullTranslateHandler.
 *
 * Responsibilities:
 *  - Initialize the floating button on page load
 *  - Wire click → toggle translation via FullTranslateHandler
 *  - Sync visual state when translation is triggered from any source (popup, floating button)
 *  - Clean up DOM on extension context invalidation
 */

import * as loggerModule from '@/0_common/utils/logger';
import { FloatingButtonManager } from '@/12_floating_button';
import type { FullTranslateEvent } from '@/1_content/handlers/FullTranslateHandler';
import * as fullTranslateHandler from '@/1_content/handlers/FullTranslateHandler';
import { getUserSettings } from '@/0_common';
import { isPageLanguageSameAsTarget } from '@/1_content/utils/pageLanguageChecker';

const logger = loggerModule.createLogger('Content/FloatingButtonIntegration');

let floatingButtonManager: FloatingButtonManager | null = null;

/**
 * Initialize the floating button and wire it to translation controls.
 * The manager always initializes (DOM created) but hides itself when disabled.
 * Toggling enabled via popup/options shows/hides the button without page refresh.
 */
export async function setup(): Promise<void> {
    // Always hide floating button when page language matches target language
    const settings = await getUserSettings();
    if (isPageLanguageSameAsTarget(settings.targetLanguage)) {
        logger.info('Floating button suppressed: page language matches target language');
        return;
    }

    floatingButtonManager = new FloatingButtonManager();

    await floatingButtonManager.initialize(() => {
        handleButtonClick();
    });

    if (!floatingButtonManager.isActive()) {
        // Not renderable (non-HTTP page or site disabled) — clean up
        floatingButtonManager = null;
        return;
    }

    // Sync state when translation is triggered by other sources (e.g., popup)
    fullTranslateHandler.addEventListener(handleTranslateEvent);

    // Sync initial state if translation is already running (e.g., popup started it before button init)
    if (fullTranslateHandler.getIsRunning()) {
        floatingButtonManager.setTranslationState('active');
    }

    logger.info('Floating button integration initialized');
}

/** Handle floating button click — toggle translation */
async function handleButtonClick(): Promise<void> {
    await fullTranslateHandler.toggle();
}

/** Map FullTranslateEvents to floating button visual states */
function handleTranslateEvent(event: FullTranslateEvent): void {
    if (!floatingButtonManager?.isActive()) return;

    switch (event) {
        case 'starting':
            floatingButtonManager.setTranslationState('translating');
            break;
        case 'started':
            floatingButtonManager.setTranslationState('active');
            break;
        case 'stopped':
        case 'error':
            floatingButtonManager.setTranslationState('idle');
            break;
        case 'quota_exhausted':
            floatingButtonManager.setTranslationState('quota_exhausted');
            break;
    }
}

/** Clean up the floating button — call on extension context invalidation */
export function destroy(): void {
    if (floatingButtonManager) {
        fullTranslateHandler.removeEventListener(handleTranslateEvent);
        floatingButtonManager.destroy();
        floatingButtonManager = null;
        logger.info('Floating button integration destroyed');
    }
}

