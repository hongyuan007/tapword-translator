/**
 * @file colors.ts
 * Pure color utility functions with no DOM or side-effect dependencies.
 * Covers CSS color parsing (rgb/rgba/hex), Porter-Duff alpha compositing,
 * WCAG relative luminance, contrast ratio calculation, and high-contrast
 * text color selection.
 */
import type { RgbaColor } from "./types"

// Output color strings for high-contrast text selection
const BLACK_TEXT_COLOR = "rgb(0, 0, 0)"
const WHITE_TEXT_COLOR = "rgb(255, 255, 255)"

/** Alpha threshold below which a color is considered invisible/transparent. */
export const MIN_VISIBLE_ALPHA = 0.01

export const BLACK_COLOR: RgbaColor = { r: 0, g: 0, b: 0, a: 1 }
export const WHITE_COLOR: RgbaColor = { r: 255, g: 255, b: 255, a: 1 }

/**
 * Parses a CSS color string (rgb, rgba, 6-digit hex, or 3-digit hex) into an RGBA object.
 * Returns `null` for unrecognised formats.
 */
export function parseColor(colorString: string): RgbaColor | null {
    if (!colorString) return null

    const rgbaMatch = colorString.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1] ?? "0", 10),
            g: parseInt(rgbaMatch[2] ?? "0", 10),
            b: parseInt(rgbaMatch[3] ?? "0", 10),
            a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
        }
    }

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
 * Alpha-composites a semi-transparent foreground color over an opaque background
 * using the standard Porter-Duff "over" operation.
 */
export function compositeForegroundOverBackground(foreground: RgbaColor, background: RgbaColor): RgbaColor {
    const alpha = foreground.a + background.a * (1 - foreground.a)
    if (alpha <= 0) {
        return { r: 0, g: 0, b: 0, a: 0 }
    }

    return {
        r: Math.round((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha),
        g: Math.round((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha),
        b: Math.round((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha),
        a: alpha,
    }
}

/** Guards that a parsed color is non-null and has a meaningful alpha value. */
export function isVisibleBackground(color: RgbaColor | null): color is RgbaColor {
    return !!color && color.a > MIN_VISIBLE_ALPHA
}

/**
 * Converts an 8-bit sRGB channel value to linear light for WCAG luminance calculation.
 * See: https://www.w3.org/TR/WCAG20-TECHS/G17.html
 */
function toLinearColorSpace(channel: number): number {
    const normalized = channel / 255
    if (normalized <= 0.03928) {
        return normalized / 12.92
    }
    return Math.pow((normalized + 0.055) / 1.055, 2.4)
}

/** Calculates the WCAG relative luminance of an opaque RGB color (0 = black, 1 = white). */
function getRelativeLuminance(color: RgbaColor): number {
    return (
        0.2126 * toLinearColorSpace(color.r) +
        0.7152 * toLinearColorSpace(color.g) +
        0.0722 * toLinearColorSpace(color.b)
    )
}

/** Returns the WCAG contrast ratio between two colors (range: 1–21). */
export function calculateContrastRatio(colorA: RgbaColor, colorB: RgbaColor): number {
    const luminanceA = getRelativeLuminance(colorA)
    const luminanceB = getRelativeLuminance(colorB)
    const lighter = Math.max(luminanceA, luminanceB)
    const darker = Math.min(luminanceA, luminanceB)
    return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Returns the CSS color string (`rgb(0,0,0)` or `rgb(255,255,255)`) that provides
 * the highest contrast against the given background.
 */
export function getHighContrastColor(backgroundColor: RgbaColor): string {
    const blackContrast = calculateContrastRatio(BLACK_COLOR, backgroundColor)
    const whiteContrast = calculateContrastRatio(WHITE_COLOR, backgroundColor)
    return blackContrast >= whiteContrast ? BLACK_TEXT_COLOR : WHITE_TEXT_COLOR
}
