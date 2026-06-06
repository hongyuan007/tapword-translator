/**
 * Toast Template
 *
 * Defines the visual structure, design tokens, and type-specific
 * configurations for viewport toast notifications.
 *
 * Architecture:
 * - `TOAST_TYPE_CONFIGS`: Lookup object mapping each ToastType to its
 *   accent color, icon label, and icon background. Adding a new toast
 *   type only requires one new entry here.
 * - `createToastElements()`: Builds the full DOM tree (card, brand icon,
 *   message area, close button) with inline styles so the toast renders
 *   correctly inside any host page (content-script context, no external CSS).
 * - Lifecycle logic (animation, auto-dismiss, event binding) stays in
 *   `toastNotification.ts`.
 */

// ============================================================================
// Public Types
// ============================================================================

/** Supported toast visual variants */
export type ToastType = "info" | "warning" | "error" | "success"

// ============================================================================
// Design Tokens
// ============================================================================

// Layout
const CARD_MIN_WIDTH = "min(320px, calc(100vw - 32px))"
const CARD_WIDTH = "min(460px, calc(100vw - 32px))"
const CARD_MAX_WIDTH = "calc(100vw - 32px)"
const CARD_PADDING = "12px 16px"
const CARD_BORDER_RADIUS = "12px"

// Icon
const ICON_SIZE = "28px"
const ICON_BORDER_RADIUS = "6px"
const ICON_FONT_SIZE = "18px"

// Typography
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MESSAGE_FONT_SIZE = "14px"
const MESSAGE_FONT_WEIGHT = "500"
const MESSAGE_LINE_HEIGHT = "1.4"

// Colors
const CARD_BG = "#ffffff"
const TEXT_PRIMARY = "#1f2937"
const BORDER_COLOR = "rgba(0, 0, 0, 0.06)"
const SHADOW = "0 4px 12px rgba(0, 0, 0, 0.05), 0 8px 32px rgba(0, 0, 0, 0.08)"

// Close button
const CLOSE_BTN_SIZE = "24px"
const CLOSE_COLOR_DEFAULT = "#9ca3af"
const CLOSE_HOVER_BG = "#f3f4f6"
const CLOSE_HOVER_COLOR = "#4b5563"

// Close button SVG icon (inline, no external assets)
const CLOSE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`

// Animation
/** Entry animation: bouncy cubic-bezier */
export const ENTRY_TRANSITION = "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
/** Exit animation: smooth ease-out */
export const EXIT_TRANSITION = "all 0.2s ease-out"

// ============================================================================
// Type-Specific Configuration
// ============================================================================

interface ToastTypeConfig {
    /** Background color of the icon badge */
    iconBg: string
    /** Text content of the icon badge */
    iconLabel: string
    /** Text color of the icon badge */
    iconColor: string
    /** Subtle shadow tint for the icon badge */
    iconShadow: string
}

/** Lookup table – add a new toast type by adding one entry here */
const TOAST_TYPE_CONFIGS: Record<ToastType, ToastTypeConfig> = {
    info: {
        iconBg: "#ED6D8F",
        iconLabel: "T",
        iconColor: "#ffffff",
        iconShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    success: {
        iconBg: "#22c55e",
        iconLabel: "✓",
        iconColor: "#ffffff",
        iconShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    warning: {
        iconBg: "#f59e0b",
        iconLabel: "!",
        iconColor: "#ffffff",
        iconShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    error: {
        iconBg: "#ef4444",
        iconLabel: "✕",
        iconColor: "#ffffff",
        iconShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
}

// ============================================================================
// DOM Element Result
// ============================================================================

/** The set of DOM elements returned by the template builder */
export interface ToastElements {
    /** Root toast card element */
    card: HTMLDivElement
    /** Close button element (caller binds the click handler) */
    closeBtn: HTMLButtonElement
}

// ============================================================================
// Template Builder
// ============================================================================

/**
 * Build the full DOM tree for a viewport toast notification.
 *
 * The returned elements are ready to be appended to `document.body`.
 * The card starts in its hidden pre-animation state (opacity 0,
 * shifted upward). The caller is responsible for triggering the
 * entry animation and wiring up close/dismiss behaviour.
 *
 * @param message - Text to display
 * @param type    - Visual variant (determines icon and accent colour)
 * @returns       - The root card element and close button reference
 */
export function createToastElements(message: string, type: ToastType): ToastElements {
    const config = TOAST_TYPE_CONFIGS[type]

    // --- Card ---
    const card = document.createElement("div")
    Object.assign(card.style, {
        position: "fixed",
        top: "24px",
        left: "50%",
        zIndex: "2147483647",
        display: "flex",
        alignItems: "flex-start",
        padding: CARD_PADDING,
        width: CARD_WIDTH,
        minWidth: CARD_MIN_WIDTH,
        maxWidth: CARD_MAX_WIDTH,
        boxSizing: "border-box",
        background: CARD_BG,
        borderRadius: CARD_BORDER_RADIUS,
        border: `1px solid ${BORDER_COLOR}`,
        boxShadow: SHADOW,
        fontFamily: FONT_FAMILY,
        pointerEvents: "auto",
        // Initial (hidden) animation state
        opacity: "0",
        transform: "translateX(-50%) translateY(-20px) scale(0.95)",
        transition: ENTRY_TRANSITION,
    } satisfies Partial<CSSStyleDeclaration>)

    // --- Icon Badge ---
    const iconBadge = document.createElement("div")
    Object.assign(iconBadge.style, {
        flexShrink: "0",
        width: ICON_SIZE,
        height: ICON_SIZE,
        marginRight: "12px",
        background: config.iconBg,
        borderRadius: ICON_BORDER_RADIUS,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        color: config.iconColor,
        fontSize: ICON_FONT_SIZE,
        fontWeight: "bold",
        fontStyle: "italic",
        lineHeight: "1",
        userSelect: "none",
        boxShadow: config.iconShadow,
    } satisfies Partial<CSSStyleDeclaration>)
    iconBadge.textContent = config.iconLabel

    // --- Content Area ---
    const content = document.createElement("div")
    Object.assign(content.style, {
        flexGrow: "1",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: ICON_SIZE,
    } satisfies Partial<CSSStyleDeclaration>)

    const messageEl = document.createElement("p")
    Object.assign(messageEl.style, {
        fontSize: MESSAGE_FONT_SIZE,
        fontWeight: MESSAGE_FONT_WEIGHT,
        color: TEXT_PRIMARY,
        lineHeight: MESSAGE_LINE_HEIGHT,
        margin: "0",
        wordBreak: "break-word",
    } satisfies Partial<CSSStyleDeclaration>)
    messageEl.textContent = message
    content.appendChild(messageEl)

    // --- Close Button ---
    const closeBtn = document.createElement("button")
    Object.assign(closeBtn.style, {
        flexShrink: "0",
        width: CLOSE_BTN_SIZE,
        height: CLOSE_BTN_SIZE,
        marginLeft: "12px",
        marginRight: "-4px",
        borderRadius: "6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        color: CLOSE_COLOR_DEFAULT,
        cursor: "pointer",
        transition: "background 0.2s, color 0.2s",
        padding: "0",
    } satisfies Partial<CSSStyleDeclaration>)
    closeBtn.innerHTML = CLOSE_ICON_SVG

    // Hover effects (inline, no external CSS)
    closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.background = CLOSE_HOVER_BG
        closeBtn.style.color = CLOSE_HOVER_COLOR
    })
    closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.background = "transparent"
        closeBtn.style.color = CLOSE_COLOR_DEFAULT
    })

    // --- Assemble ---
    card.appendChild(iconBadge)
    card.appendChild(content)
    card.appendChild(closeBtn)

    return { card, closeBtn }
}
