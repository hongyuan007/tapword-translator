/**
 * @file dom.ts
 * DOM-dependent background color resolution.
 * Traverses the element ancestor chain to collect and composite all
 * semi-transparent background layers, and detects whether the page
 * is using a dark color scheme via class name or CSS `color-scheme`.
 */
import type { RgbaColor } from "./types"
import { parseColor, isVisibleBackground, compositeForegroundOverBackground, BLACK_COLOR } from "./colors"

const DARK_THEME_CLASS = "dark"
const DARK_COLOR_SCHEME = "dark"

/** Fallback background when no visible background layer can be resolved from the DOM. */
const DEFAULT_PAGE_BACKGROUND: RgbaColor = { r: 255, g: 255, b: 255, a: 1 }

/**
 * Detects whether the page is using a dark color scheme by checking the `<html>`
 * element's `dark` class (common in Tailwind/Bootstrap projects) and the CSS
 * `color-scheme` computed property.
 */
function isDarkThemeContext(): boolean {
    const rootElement = document.documentElement
    if (rootElement.classList.contains(DARK_THEME_CLASS)) {
        return true
    }
    return window.getComputedStyle(rootElement).colorScheme.includes(DARK_COLOR_SCHEME)
}

/**
 * Walks up the DOM from `startElement`, collecting every visible background-color
 * layer. Falls back to `<body>` and `<html>` background colors when no layers are
 * found on the element's ancestors (e.g., when all ancestors are transparent).
 */
function collectBackgroundLayers(startElement: HTMLElement | null): RgbaColor[] {
    const layers: RgbaColor[] = []
    let currentElement: HTMLElement | null = startElement

    while (currentElement) {
        const backgroundColor = parseColor(window.getComputedStyle(currentElement).backgroundColor)
        if (isVisibleBackground(backgroundColor)) {
            layers.push(backgroundColor)
        }
        currentElement = currentElement.parentElement
    }

    if (layers.length > 0) {
        return layers
    }

    // No opaque ancestor found — use document-level backgrounds as last resort
    const bodyBackground = document.body ? parseColor(window.getComputedStyle(document.body).backgroundColor) : null
    if (isVisibleBackground(bodyBackground)) {
        layers.push(bodyBackground)
    }

    const htmlBackground = parseColor(window.getComputedStyle(document.documentElement).backgroundColor)
    if (isVisibleBackground(htmlBackground)) {
        layers.push(htmlBackground)
    }

    return layers
}

/**
 * Resolves the effective (composited) background color seen behind the given element
 * by stacking all transparent ancestor layers from bottom to top.
 *
 * @param startElement - The element whose background context is being resolved.
 * @returns The final composited opaque background color.
 */
export function getEffectiveBackgroundColor(startElement: HTMLElement | null): RgbaColor {
    const backgroundLayers = collectBackgroundLayers(startElement)

    if (backgroundLayers.length === 0) {
        // When all layers are transparent, infer a sensible default from the theme
        return isDarkThemeContext() ? BLACK_COLOR : DEFAULT_PAGE_BACKGROUND
    }

    // Composite layers from the outermost (bottom) to the innermost (top)
    let composedBackground = DEFAULT_PAGE_BACKGROUND
    for (let index = backgroundLayers.length - 1; index >= 0; index--) {
        const layer = backgroundLayers[index]
        if (!layer) continue
        composedBackground = compositeForegroundOverBackground(layer, composedBackground)
    }

    return composedBackground
}
