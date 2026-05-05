/**
 * Constants for the floating button module.
 */

import type { FloatingButtonConfig } from '@/12_floating_button/types';

// --- Storage ---

/** chrome.storage.local key for floating button config */
export const FLOATING_BUTTON_STORAGE_KEY = 'floatingButtonConfig';

/** Default brand color for the floating button icon */
export const DEFAULT_ICON_COLOR = '#F472B6';

/** Default configuration values */
export const DEFAULT_CONFIG: FloatingButtonConfig = {
    enabled: false,
    position: 0.66,
    disabledSites: [],
    iconVariant: 'v5',
    iconColor: DEFAULT_ICON_COLOR,
    autoHideOnQuotaExhausted: true,
};

// --- CSS ---

/** Prefix for all CSS class names to avoid host page conflicts */
export const CSS_PREFIX = 'tw-fab';

/** Z-index ensuring the button renders above all host page content */
export const Z_INDEX = 2147483647;

// --- CSS Class Names ---

export const CLASS_CONTAINER = `${CSS_PREFIX}-container`;
export const CLASS_MAIN_BUTTON = `${CSS_PREFIX}-main`;
export const CLASS_CLOSE_BUTTON = `${CSS_PREFIX}-close`;
export const CLASS_ACTIVE_BADGE = `${CSS_PREFIX}-badge`;
export const CLASS_DROPDOWN = `${CSS_PREFIX}-dropdown`;
export const CLASS_DROPDOWN_ITEM = `${CSS_PREFIX}-dropdown-item`;
export const CLASS_STYLE_TAG = `${CSS_PREFIX}-styles`;
export const CLASS_SPINNER = `${CSS_PREFIX}-spinner`;

// --- Drag ---

/** Minimum movement in pixels to distinguish drag from click */
export const DRAG_THRESHOLD_PX = 5;

/** Minimum distance from viewport top (px) */
export const MIN_TOP_PX = 30;

/** Minimum distance from viewport bottom (px) */
export const MIN_BOTTOM_PX = 100;

// --- Dimensions ---

/** Main button height in pixels */
export const BUTTON_HEIGHT_PX = 40;

/** Main button width in pixels */
export const BUTTON_WIDTH_PX = 46;

/** Close button diameter in pixels */
export const CLOSE_BUTTON_SIZE_PX = 16;

/** Active badge diameter in pixels */
export const BADGE_SIZE_PX = 12;

/** Dropdown menu width in pixels */
export const DROPDOWN_WIDTH_PX = 180;

// --- Visual ---

/** Idle opacity (70%) */
export const IDLE_OPACITY = 0.7;

/** Transition duration for opacity */
export const TRANSITION_DURATION_MS = 300;

/** Active badge color */
export const BADGE_COLOR = '#22c55e';

/** Exhausted badge color (gray-400) */
export const BADGE_COLOR_EXHAUSTED = '#9ca3af';

/** CSS class for quota-exhausted state */
export const CLASS_EXHAUSTED_BADGE = `${CSS_PREFIX}-exhausted-badge`;

/** CSS class applied to main button when translation is active or translating */
export const CLASS_TRANSLATION_ACTIVE = `${CSS_PREFIX}-translation-active`;

// --- Auto-Hide ---

/** Delay before auto-hiding the button when quota is exhausted (ms) */
export const AUTO_HIDE_DELAY_MS = 3000;

/** Duration of the slide-out animation before hiding (ms) */
export const SLIDE_OUT_DURATION_MS = 400;

/** CSS class applied during slide-out animation */
export const CLASS_SLIDING_OUT = `${CSS_PREFIX}-sliding-out`;
