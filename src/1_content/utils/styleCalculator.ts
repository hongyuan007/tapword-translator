/**
 * Tooltip Style Calculator
 *
 * Calculates the optimal font size and color for the translation tooltip
 * based on the styles of the original selected text element.
 */
import * as types from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as contentConstants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"

const logger = loggerModule.createLogger("styleCalculator")

interface RgbaColor {
    r: number
    g: number
    b: number
    a: number
}

const BLACK_TEXT_COLOR = "rgb(0, 0, 0)"
const WHITE_TEXT_COLOR = "rgb(255, 255, 255)"
const DARK_THEME_CLASS = "dark"
const DARK_COLOR_SCHEME = "dark"
const MIN_VISIBLE_ALPHA = 0.01
const DEFAULT_PAGE_BACKGROUND: RgbaColor = {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
}
const BLACK_COLOR: RgbaColor = {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
}
const WHITE_COLOR: RgbaColor = {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
}

function isDarkThemeContext(): boolean {
    const rootElement = document.documentElement
    if (rootElement.classList.contains(DARK_THEME_CLASS)) {
        return true
    }

    const colorScheme = window.getComputedStyle(rootElement).colorScheme
    return colorScheme.includes(DARK_COLOR_SCHEME)
}

// ============================================================================
// Color Manipulation
// ============================================================================

/**
 * Parses a CSS color string (rgb, rgba, or hex) into an RGBA object.
 * @param colorString - The CSS color string.
 * @returns An object with r, g, b, a properties, or null if parsing fails.
 */
function parseColor(colorString: string): RgbaColor | null {
    if (!colorString) return null

    // RGB or RGBA
    const rgbaMatch = colorString.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1] ?? "0", 10),
            g: parseInt(rgbaMatch[2] ?? "0", 10),
            b: parseInt(rgbaMatch[3] ?? "0", 10),
            a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
        }
    }

    // Hex (e.g., #abc, #abcdef)
    const hexMatch = colorString.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (hexMatch) {
        return {
            r: parseInt(hexMatch[1] ?? "00", 16),
            g: parseInt(hexMatch[2] ?? "00", 16),
            b: parseInt(hexMatch[3] ?? "00", 16),
            a: 1,
        }
    }
    const shortHexMatch = colorString.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i)
    if (shortHexMatch) {
        const r = shortHexMatch[1] ?? "0"
        const g = shortHexMatch[2] ?? "0"
        const b = shortHexMatch[3] ?? "0"
        return {
            r: parseInt(r + r, 16),
            g: parseInt(g + g, 16),
            b: parseInt(b + b, 16),
            a: 1,
        }
    }

    return null
}

/**
 * Composites a foreground color over a background color.
 */
function compositeForegroundOverBackground(foreground: RgbaColor, background: RgbaColor): RgbaColor {
    const alpha = foreground.a + background.a * (1 - foreground.a)
    if (alpha <= 0) {
        return {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
        }
    }

    return {
        r: Math.round((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha),
        g: Math.round((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha),
        b: Math.round((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha),
        a: alpha,
    }
}

function isVisibleBackground(color: RgbaColor | null): color is RgbaColor {
    return !!color && color.a > MIN_VISIBLE_ALPHA
}

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

    const bodyBackgroundColor = document.body ? parseColor(window.getComputedStyle(document.body).backgroundColor) : null
    if (isVisibleBackground(bodyBackgroundColor)) {
        layers.push(bodyBackgroundColor)
    }

    const htmlBackgroundColor = parseColor(window.getComputedStyle(document.documentElement).backgroundColor)
    if (isVisibleBackground(htmlBackgroundColor)) {
        layers.push(htmlBackgroundColor)
    }

    return layers
}

function getEffectiveBackgroundColor(startElement: HTMLElement | null): RgbaColor {
    const backgroundLayers = collectBackgroundLayers(startElement)

    if (backgroundLayers.length === 0) {
        return isDarkThemeContext() ? BLACK_COLOR : DEFAULT_PAGE_BACKGROUND
    }

    let composedBackground = DEFAULT_PAGE_BACKGROUND
    for (let index = backgroundLayers.length - 1; index >= 0; index--) {
        const layer = backgroundLayers[index]
        if (!layer) {
            continue
        }
        composedBackground = compositeForegroundOverBackground(layer, composedBackground)
    }

    return composedBackground
}

function toLinearColorSpace(channel: number): number {
    const normalized = channel / 255
    if (normalized <= 0.03928) {
        return normalized / 12.92
    }
    return Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function getRelativeLuminance(color: RgbaColor): number {
    const linearRed = toLinearColorSpace(color.r)
    const linearGreen = toLinearColorSpace(color.g)
    const linearBlue = toLinearColorSpace(color.b)
    return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue
}

function calculateContrastRatio(colorA: RgbaColor, colorB: RgbaColor): number {
    const luminanceA = getRelativeLuminance(colorA)
    const luminanceB = getRelativeLuminance(colorB)
    const lighter = Math.max(luminanceA, luminanceB)
    const darker = Math.min(luminanceA, luminanceB)
    return (lighter + 0.05) / (darker + 0.05)
}

function getHighContrastColor(backgroundColor: RgbaColor): string {
    const blackContrast = calculateContrastRatio(BLACK_COLOR, backgroundColor)
    const whiteContrast = calculateContrastRatio(WHITE_COLOR, backgroundColor)
    return blackContrast >= whiteContrast ? BLACK_TEXT_COLOR : WHITE_TEXT_COLOR
}

// ============================================================================
// Font Size Calculation
// ============================================================================

// Constants
const UI_SPACING_PX = 3
const MAX_FONT_RATIO = 0.8
const LAST_LINE_EPSILON_PX = 1.5

function isHeadingElement(el: HTMLElement | null): boolean {
    if (!el) return false
    const tag = el.tagName?.toUpperCase()
    return tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6"
}

function isSelectionOnLastLine(anchor: HTMLElement | null, container: HTMLElement | null): boolean {
    if (!anchor || !container) return false
    const rects = anchor.getClientRects()
    if (!rects || rects.length === 0) return false
    const lastRect = rects[rects.length - 1] as DOMRect | ClientRect | undefined
    if (!lastRect) return false
    const containerBottom = container.getBoundingClientRect().bottom
    const delta = containerBottom - lastRect.bottom
    return delta <= LAST_LINE_EPSILON_PX
}

/**
 * Calculate optimal translation font size based on available line spacing.
 * Returns both the font size and detailed calculation information.
 */
function calculateOptimalTranslationFontSize(
    originalElement: HTMLElement | null,
    originalFontSize: number,
    anchor?: HTMLElement | null,
    minFontSizeOverride?: number
): { fontSize: number; spaceCalculation: SpaceCalculation } {
    logger.info(`Calculating font size. Original: ${originalFontSize}px`, originalElement)

    const cachedSettings = contentIndex.getCachedUserSettings()
    const minFontSize = minFontSizeOverride ?? contentConstants.MIN_TOOLTIP_FONT_PX
    const desiredGap = cachedSettings?.tooltipNextLineGapPxV2 ?? types.DEFAULT_USER_SETTINGS.tooltipNextLineGapPxV2

    if (!originalElement) {
        const fallbackSize = originalFontSize * 0.7
        const maxFontSize = originalFontSize * MAX_FONT_RATIO
        const safetyDelta = contentConstants.MIN_TOOLTIP_SAFETY_DELTA_PX
        const adjustedFallback = Math.max(fallbackSize - safetyDelta - desiredGap, 0)
        const computedFontSize = Math.max(Math.min(adjustedFallback, maxFontSize), minFontSize)

        logger.info(
            `No original element. Fallback font: ${computedFontSize.toFixed(2)}px (base=${fallbackSize.toFixed(2)}px, safetyDelta=${safetyDelta})`
        )

        return {
            fontSize: computedFontSize,
            spaceCalculation: {
                originalFontSize,
                lineHeight: originalFontSize * 1.2,
                lineSpacing: originalFontSize * 0.2,
                availableSpace: fallbackSize,
                requiredFontSize: computedFontSize,
                minFontSize,
                maxFontSize,
            },
        }
    }

    const computedStyle = window.getComputedStyle(originalElement)
    let lineHeight = parseFloat(computedStyle.lineHeight)

    // Handle line-height: normal (not a number)
    if (isNaN(lineHeight)) {
        // Default browser behavior: normal is approximately 1.2 times font size
        lineHeight = originalFontSize * 1.2
    }

    // Calculate available line spacing
    const lineSpacing = lineHeight - originalFontSize

    // Internal space under the line (body text friendly)
    const internalAvailable = lineSpacing - UI_SPACING_PX

    // Heading optimization: if anchor is on the last line of a heading, prefer margin-bottom
    let availableSpace = internalAvailable
    const heading = isHeadingElement(originalElement)
    const onLastLine = isSelectionOnLastLine(anchor || null, originalElement)
    if (heading && onLastLine) {
        const mb = parseFloat(computedStyle.marginBottom)
        const marginAvailable = (isNaN(mb) ? 0 : mb) - UI_SPACING_PX
        if (marginAvailable > 0) {
            logger.info(`Heading on last line detected. Using margin-bottom for available space: ${marginAvailable}px`)
            availableSpace = marginAvailable
        }
    }

    // Constraints
    const maxFontSize = originalFontSize * MAX_FONT_RATIO

    // Apply safety delta so tooltip font is slightly smaller than available space
    const safetyDelta = contentConstants.MIN_TOOLTIP_SAFETY_DELTA_PX
    const effectiveAvailable = Math.max(availableSpace - safetyDelta - desiredGap, 0)

    // Calculate optimal font size using effective available space
    let translationFontSize = Math.min(effectiveAvailable, maxFontSize)
    translationFontSize = Math.max(translationFontSize, minFontSize)

    const spaceCalculation: SpaceCalculation = {
        originalFontSize,
        lineHeight,
        lineSpacing,
        availableSpace,
        requiredFontSize: translationFontSize,
        minFontSize,
        maxFontSize,
    }

    logger.info(
        `Font size calculation complete. ` +
            `Result: ${translationFontSize.toFixed(2)}px. ` +
            `Details: original=${originalFontSize.toFixed(2)}px, ` +
            `lineHeight=${lineHeight.toFixed(2)}px, ` +
            `lineSpacing=${lineSpacing.toFixed(2)}px, ` +
            `availableSpace=${availableSpace.toFixed(2)}px, ` +
            `effectiveAvailable=${effectiveAvailable.toFixed(2)}px, safetyDelta=${safetyDelta}, ` +
            `constraints(min=${minFontSize}, max=${maxFontSize.toFixed(2)})`
    )

    return { fontSize: translationFontSize, spaceCalculation }
}

// ============================================================================
// Composite Style Calculation
// ============================================================================

/**
 * Detailed space calculation information for line-height adjustment
 */
export interface SpaceCalculation {
    originalFontSize: number
    lineHeight: number
    lineSpacing: number
    availableSpace: number
    requiredFontSize: number
    minFontSize: number
    maxFontSize: number
}

/**
 * Tooltip style result including font size, color, and space calculation
 */
export interface TooltipStyle {
    fontSize: number
    color: string
    spaceCalculation?: SpaceCalculation
}

/**
 * Calculates the complete style (font size and color) for the tooltip.
 * @param originalElement - The parent element of the selected text.
 * @param anchor - The anchor element (the wrapped translated text).
 * @param fallbackFontSize - A fallback font size if it cannot be determined.
 * @param minFontSize - Optional minimum font size for translation (user setting).
 * @returns An object with `fontSize`, `color`, and `spaceCalculation` properties.
 */
export function calculateTooltipStyle(
    originalElement: HTMLElement | null,
    anchor?: HTMLElement | null,
    fallbackFontSize = 16,
    minFontSize?: number
): TooltipStyle {
    const computedStyle = originalElement ? window.getComputedStyle(originalElement) : null
    const originalFontSize = computedStyle ? parseFloat(computedStyle.fontSize) : fallbackFontSize

    const colorElement = anchor ?? originalElement
    const effectiveBackgroundColor = getEffectiveBackgroundColor(colorElement)
    const result = calculateOptimalTranslationFontSize(originalElement, originalFontSize, anchor, minFontSize)
    const color = getHighContrastColor(effectiveBackgroundColor)

    return {
        fontSize: result.fontSize,
        color,
        spaceCalculation: result.spaceCalculation,
    }
}
