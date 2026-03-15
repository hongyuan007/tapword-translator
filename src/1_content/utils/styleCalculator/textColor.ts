/**
 * @file textColor.ts
 * Tooltip text color decision logic.
 *
 * Prefers the host page text color, but nudges it slightly toward higher contrast
 * and forces full opacity so tooltip text stays readable without looking harsher
 * than the surrounding typography. Falls back to a black/white contrast color when
 * the host text color cannot be normalized.
 */
import type { BackgroundResolutionResult } from "./dom"
import type { RgbaColor } from "./types"
import {
    formatRgbColor,
    getBoostedContrastColor,
    getHighContrastColor,
    getMonochromeColorFromCssColor,
    parseColor,
} from "./colors"

const COLOR_NORMALIZATION_PROBE_TAG = "span"
const HOST_TEXT_CONTRAST_BOOST = 0.08
const normalizedColorCache = new Map<string, string | null>()

export interface TooltipTextColorDecision {
    color: string
    source: "boosted-host-text" | "background-contrast"
    rawHostTextColor: string | null
    normalizedHostTextColor: string | null
    boostedHostTextColor: string | null
    backgroundContrastColor: string
}

function normalizeCssColor(color: string | null | undefined): string | null {
    if (!color || color.trim().length === 0 || typeof document === "undefined") {
        return null
    }

    const cachedColor = normalizedColorCache.get(color)
    if (cachedColor !== undefined) {
        return cachedColor
    }

    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (context) {
        try {
            context.fillStyle = "#000000"
            context.fillStyle = color
            const canvasColor = context.fillStyle
            if (canvasColor && canvasColor.trim().length > 0) {
                normalizedColorCache.set(color, canvasColor)
                return canvasColor
            }
        } catch {
            // Ignore and fall through to DOM-based normalization.
        }
    }

    const probe = document.createElement(COLOR_NORMALIZATION_PROBE_TAG)
    probe.style.color = color
    probe.style.display = "none"
    document.documentElement.appendChild(probe)

    try {
        const normalizedColor = window.getComputedStyle(probe).color || null
        normalizedColorCache.set(color, normalizedColor)
        return normalizedColor
    } finally {
        probe.remove()
    }
}

function parseHostTextColor(rawHostTextColor: string | null, normalizedHostTextColor: string | null): RgbaColor | null {
    if (normalizedHostTextColor) {
        const parsedNormalizedColor = parseColor(normalizedHostTextColor)
        if (parsedNormalizedColor) {
            return parsedNormalizedColor
        }
    }

    if (rawHostTextColor) {
        const parsedRawColor = parseColor(rawHostTextColor)
        if (parsedRawColor) {
            return parsedRawColor
        }
    }

    return null
}

function deriveBoostedHostTextColor(rawHostTextColor: string | null, normalizedHostTextColor: string | null): string | null {
    const parsedHostTextColor = parseHostTextColor(rawHostTextColor, normalizedHostTextColor)
    if (parsedHostTextColor) {
        return formatRgbColor(getBoostedContrastColor(parsedHostTextColor, HOST_TEXT_CONTRAST_BOOST))
    }

    const monochromeFallback = normalizedHostTextColor
        ? getMonochromeColorFromCssColor(normalizedHostTextColor)
        : (rawHostTextColor ? getMonochromeColorFromCssColor(rawHostTextColor) : null)
    return monochromeFallback
}

export function resolveTooltipTextColor(
    computedStyle: CSSStyleDeclaration | null,
    backgroundResolution: BackgroundResolutionResult
): TooltipTextColorDecision {
    const rawHostTextColor = computedStyle?.color?.trim() || null
    const normalizedHostTextColor = normalizeCssColor(rawHostTextColor)
    const backgroundContrastColor = getHighContrastColor(backgroundResolution.backgroundColor)
    const boostedHostTextColor = deriveBoostedHostTextColor(rawHostTextColor, normalizedHostTextColor)

    if (boostedHostTextColor) {
        return {
            color: boostedHostTextColor,
            source: "boosted-host-text",
            rawHostTextColor,
            normalizedHostTextColor,
            boostedHostTextColor,
            backgroundContrastColor,
        }
    }

    return {
        color: backgroundContrastColor,
        source: "background-contrast",
        rawHostTextColor,
        normalizedHostTextColor,
        boostedHostTextColor: null,
        backgroundContrastColor,
    }
}
