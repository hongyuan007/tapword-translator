/**
 * CSS styles for the sidepanel floating button.
 * Injected inside a Shadow DOM to isolate from host page.
 */

import * as constants from './constants';

export const SIDEPANEL_BUTTON_STYLES = `
/* Hide sidepanel button when printing */
@media print {
    .${constants.CLASS_CONTAINER} {
        display: none !important;
    }
}

/* Container — fixed position at bottom-right */
.${constants.CLASS_CONTAINER} {
    position: fixed;
    bottom: ${constants.POSITION_BOTTOM_PX}px;
    right: ${constants.POSITION_RIGHT_PX}px;
    z-index: ${constants.Z_INDEX};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: auto;
}

/* Round button */
.${constants.CLASS_BUTTON} {
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${constants.BUTTON_SIZE_PX}px;
    height: ${constants.BUTTON_SIZE_PX}px;
    border: none;
    border-radius: 50%;
    background: ${constants.BG_COLOR_DEFAULT};
    box-shadow: ${constants.BOX_SHADOW};
    cursor: pointer;
    transition: background ${constants.TRANSITION_DURATION_MS}ms ease,
                transform ${constants.TRANSITION_DURATION_MS}ms ease;
    padding: 0;
    outline: none;
    -webkit-tap-highlight-color: transparent;
}

.${constants.CLASS_BUTTON}:hover {
    background: ${constants.BG_COLOR_HOVER};
    transform: scale(1.08);
}

.${constants.CLASS_BUTTON}:active {
    transform: scale(0.95);
}

/* Icon inside button */
.${constants.CLASS_ICON} {
    width: ${constants.ICON_SIZE_PX}px;
    height: ${constants.ICON_SIZE_PX}px;
    color: ${constants.ICON_COLOR};
    pointer-events: none;
}
`;
