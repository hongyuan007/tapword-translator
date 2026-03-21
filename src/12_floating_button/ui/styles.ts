/**
 * CSS styles for the floating button, injected as a <style> tag.
 * All classes are prefixed with `tw-fab-` to avoid host page conflicts.
 */

import * as constants from '@/12_floating_button/constants';

export const FLOATING_BUTTON_STYLES = `
/* Hide floating button when printing */
@media print {
    .${constants.CLASS_CONTAINER} {
        display: none !important;
    }
}

/* Container — positioned fixed on right edge */
.${constants.CLASS_CONTAINER} {
    position: fixed;
    right: 0;
    z-index: ${constants.Z_INDEX};
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    pointer-events: auto;
}

/* Main button — left-rounded pill, partially hidden on right edge */
.${constants.CLASS_MAIN_BUTTON} {
    position: relative;
    display: flex;
    align-items: center;
    width: ${constants.BUTTON_WIDTH_PX}px;
    height: ${constants.BUTTON_HEIGHT_PX}px;
    padding-left: 8px;
    border: 1px solid #e5e7eb;
    border-right: none;
    border-radius: 9999px 0 0 9999px;
    background: #ffffff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    opacity: ${constants.IDLE_OPACITY};
    transform: translateX(${constants.IDLE_TRANSLATE_X_PX}px);
    transition: opacity ${constants.TRANSITION_DURATION_MS}ms ease,
                transform ${constants.TRANSITION_DURATION_MS}ms ease;
    cursor: pointer;
    user-select: none;
    box-sizing: border-box;
}

.${constants.CLASS_CONTAINER}:hover .${constants.CLASS_MAIN_BUTTON},
.${constants.CLASS_MAIN_BUTTON}.${constants.CSS_PREFIX}-expanded {
    opacity: 1;
    transform: translateX(0);
}

.${constants.CLASS_MAIN_BUTTON}.${constants.CSS_PREFIX}-dragging {
    opacity: 1;
    transform: translateX(0);
    cursor: move;
    transition: none;
}

/* Design SVG icon inside main button */
.${constants.CLASS_MAIN_BUTTON} svg.design-svg {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* Close (X) button — tiny circle at top-left of main button */
.${constants.CLASS_CLOSE_BUTTON} {
    position: absolute;
    top: -5px;
    left: -5px;
    width: ${constants.CLOSE_BUTTON_SIZE_PX}px;
    height: ${constants.CLOSE_BUTTON_SIZE_PX}px;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid #e5e7eb;
    background: #f3f4f6;
    cursor: pointer;
    padding: 0;
    z-index: 1;
    box-sizing: border-box;
}

.${constants.CLASS_CLOSE_BUTTON} svg {
    width: 10px;
    height: 10px;
    color: #9ca3af;
}

.${constants.CLASS_CONTAINER}:hover .${constants.CLASS_CLOSE_BUTTON} {
    display: flex;
}

.${constants.CLASS_CLOSE_BUTTON}:hover {
    background: #e5e7eb;
}

/* Active badge — green circle with checkmark, overhang at inner icon edge */
.${constants.CLASS_ACTIVE_BADGE} {
    position: absolute;
    bottom: 4px;
    left: 26px;
    width: ${constants.BADGE_SIZE_PX}px;
    height: ${constants.BADGE_SIZE_PX}px;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: ${constants.BADGE_COLOR};
    box-sizing: border-box;
}

.${constants.CLASS_ACTIVE_BADGE} svg {
    width: 8px;
    height: 8px;
    color: #ffffff;
}

.${constants.CLASS_ACTIVE_BADGE}.${constants.CSS_PREFIX}-visible {
    display: flex;
}

/* Spinner for translating state, overhang at inner icon edge */
.${constants.CLASS_SPINNER} {
    position: absolute;
    bottom: 4px;
    left: 26px;
    width: ${constants.BADGE_SIZE_PX}px;
    height: ${constants.BADGE_SIZE_PX}px;
    display: none;
    border: 2px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: ${constants.CSS_PREFIX}-spin 0.8s linear infinite;
    box-sizing: border-box;
}

.${constants.CLASS_SPINNER}.${constants.CSS_PREFIX}-visible {
    display: block;
}

@keyframes ${constants.CSS_PREFIX}-spin {
    to { transform: rotate(360deg); }
}

/* Dropdown menu */
.${constants.CLASS_DROPDOWN} {
    position: absolute;
    top: 0;
    right: 100%;
    margin-right: 4px;
    width: ${constants.DROPDOWN_WIDTH_PX}px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 4px 0;
    display: none;
    z-index: ${constants.Z_INDEX};
    box-sizing: border-box;
}

.${constants.CLASS_DROPDOWN}.${constants.CSS_PREFIX}-visible {
    display: block;
}

/* Dropdown menu item */
.${constants.CLASS_DROPDOWN_ITEM} {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    white-space: nowrap;
    box-sizing: border-box;
    font-family: inherit;
    line-height: 1.4;
}

.${constants.CLASS_DROPDOWN_ITEM}:hover {
    background: #f3f4f6;
}
`;
