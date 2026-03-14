/**
 * @file styleCalculator.ts
 * Public entry point for tooltip style calculation.
 * Orchestrates background color resolution (dom.ts), tooltip text color selection
 * (textColor.ts), and font size derivation (layout.ts) to produce a complete
 * `TooltipStyle` result.
 * All internal helpers live in the `styleCalculator/` sub-folder.
 */
import { getEffectiveBackgroundColor } from "./styleCalculator/dom"
import { calculateOptimalTranslationFontSize } from "./styleCalculator/layout"
import { resolveTooltipTextColor } from "./styleCalculator/textColor"
import * as loggerModule from "@/0_common/utils/logger"

export type { RgbaColor, SpaceCalculation, TooltipStyle } from "./styleCalculator/types"

const logger = loggerModule.createLogger("styleCalculator")

function describeElement(element: HTMLElement | null | undefined): string {
    if (!element) {
        return "null"
    }

    const idPart = element.id ? `#${element.id}` : ""
    const classList = Array.from(element.classList).slice(0, 3)
    const classPart = classList.length > 0 ? `.${classList.join(".")}` : ""
    const textSnippet = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)
    const textPart = textSnippet ? ` text="${textSnippet}"` : ""

    return `${element.tagName.toLowerCase()}${idPart}${classPart}${textPart}`
}

function formatColorString(color: string | null | undefined): string {
    return color && color.trim().length > 0 ? color : "(empty)"
}

/**
 * Calculates the complete style (font size + high-contrast color) for a translation tooltip.
 *
 * Color prefers the host page text color, slightly boosted toward higher contrast
 * and forced opaque; background-based black/white contrast is reserved as fallback.
 *
 * Font size is computed from the available vertical space in the line-height gap of the
 * original element, then clamped to a user-configurable minimum and a ratio-based maximum.
 *
 * @param originalElement - The element that contains the selected text.
 * @param anchor - The wrapped `<span>` anchor element inserted around the selected text.
 * @param fallbackFontSize - Font size (px) used when the original element is unavailable.
 * @param minFontSize - Optional per-call override for the minimum tooltip font size.
 * @returns `TooltipStyle` with `fontSize`, `color`, and `spaceCalculation`.
 */
export function calculateTooltipStyle(
    originalElement: HTMLElement | null,
    anchor?: HTMLElement | null,
    fallbackFontSize = 16,
    minFontSize?: number
) {
    const computedStyle = originalElement ? window.getComputedStyle(originalElement) : null
    const originalFontSize = computedStyle ? parseFloat(computedStyle.fontSize) : fallbackFontSize

    const colorElement = anchor ?? originalElement
    const backgroundResolution = getEffectiveBackgroundColor(colorElement)
    const { fontSize, spaceCalculation } = calculateOptimalTranslationFontSize(
        originalElement,
        originalFontSize,
        anchor,
        minFontSize
    )
    const effectiveBackgroundColor = backgroundResolution.backgroundColor
    const textColorDecision = resolveTooltipTextColor(computedStyle, backgroundResolution)
    const color = textColorDecision.color

    logger.debug("[TooltipStyle] Calculated tooltip style", {
        originalElement: describeElement(originalElement),
        anchor: describeElement(anchor),
        originalElementComputedColor: formatColorString(computedStyle?.color),
        hasVisibleLayers: backgroundResolution.hasVisibleLayers,
        resolutionSource: backgroundResolution.resolutionSource,
        backgroundColor: `rgba(${effectiveBackgroundColor.r}, ${effectiveBackgroundColor.g}, ${effectiveBackgroundColor.b}, ${effectiveBackgroundColor.a})`,
        inheritedTextColor: formatColorString(textColorDecision.rawHostTextColor),
        normalizedInheritedTextColor: formatColorString(textColorDecision.normalizedHostTextColor),
        boostedHostTextColor: formatColorString(textColorDecision.boostedHostTextColor),
        contrastColor: textColorDecision.backgroundContrastColor,
        colorSource: textColorDecision.source,
        chosenColor: color,
        originalFontSize,
        fontSize,
    })

    return { fontSize, color, spaceCalculation }
}
