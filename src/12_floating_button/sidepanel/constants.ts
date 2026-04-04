/**
 * Constants for the sidepanel floating button.
 */

/** Prefix for all CSS class names to avoid conflicts with host page and main floating button */
export const CSS_PREFIX = 'tw-sp-fab';

/** Z-index ensuring the button renders above all host page content */
export const Z_INDEX = 2147483647;

// --- CSS Class Names ---

export const CLASS_HOST = `${CSS_PREFIX}-host`;
export const CLASS_CONTAINER = `${CSS_PREFIX}-container`;
export const CLASS_BUTTON = `${CSS_PREFIX}-button`;
export const CLASS_ICON = `${CSS_PREFIX}-icon`;

// --- Dimensions ---

/** Button diameter in pixels */
export const BUTTON_SIZE_PX = 36;

/** Icon size in pixels */
export const ICON_SIZE_PX = 18;

// --- Position ---

/** Distance from the right edge of the viewport (px) */
export const POSITION_RIGHT_PX = 16;

/** Distance from the bottom edge of the viewport (px) */
export const POSITION_BOTTOM_PX = 80;

// --- Colors ---

/** Default background color (semi-transparent dark) */
export const BG_COLOR_DEFAULT = 'rgba(30, 30, 30, 0.6)';

/** Hover background color (more opaque) */
export const BG_COLOR_HOVER = 'rgba(30, 30, 30, 0.9)';

/** Icon color */
export const ICON_COLOR = '#ffffff';

// --- Animation ---

/** Transition duration for hover effect (ms) */
export const TRANSITION_DURATION_MS = 200;

/** Box shadow for subtle depth */
export const BOX_SHADOW = '0 2px 8px rgba(0, 0, 0, 0.2)';
