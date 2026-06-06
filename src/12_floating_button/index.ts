/**
 * 12_floating_button: Floating ball button for full-text translation
 *
 * Public API — all external consumers import from this barrel file.
 */

// --- Types ---
export type { FloatingButtonConfig, FloatingButtonState, ConfigChangeCallback, IconVariant } from './types';

// --- Constants ---
export {
    FLOATING_BUTTON_STORAGE_KEY,
    DEFAULT_CONFIG,
    DEFAULT_ICON_COLOR,
    CSS_PREFIX,
    Z_INDEX,
} from './constants';

// --- Core ---
export { FloatingButtonManager } from './FloatingButtonManager';
export { FloatingButtonConfigStore } from './config/FloatingButtonConfigStore';
