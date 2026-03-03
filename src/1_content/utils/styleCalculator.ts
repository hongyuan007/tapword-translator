/**
 * @file styleCalculator.ts
 * Public entry point for tooltip style calculation.
 * Orchestrates background color resolution (dom.ts), contrast selection (colors.ts),
 * and font size derivation (layout.ts) to produce a complete `TooltipStyle` result.
 * All internal helpers live in the `styleCalculator/` sub-folder.
 */
import { getEffectiveBackgroundColor } from "./styleCalculator/dom"
import { getHighContrastColor } from "./styleCalculator/colors"
import { calculateOptimalTranslationFontSize } from "./styleCalculator/layout"

export type { RgbaColor, SpaceCalculation, TooltipStyle } from "./styleCalculator/types"

/**
 * Calculates the complete style (font size + high-contrast color) for a translation tooltip.
 *
 * Color is derived by compositing all background layers behind the anchor element and
 * choosing whichever of black or white provides the higher WCAG contrast ratio.
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
    const effectiveBackgroundColor = getEffectiveBackgroundColor(colorElement)
    const { fontSize, spaceCalculation } = calculateOptimalTranslationFontSize(
        originalElement,
        originalFontSize,
        anchor,
        minFontSize
    )
    const color = getHighContrastColor(effectiveBackgroundColor)

    return { fontSize, color, spaceCalculation }
}
