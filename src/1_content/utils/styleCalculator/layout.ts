/**
 * @file layout.ts
 * Tooltip font size calculation based on available line-height space.
 * Analyzes the computed style of the original element, detects heading
 * vs body-text context, and derives a font size that fits within the
 * vertical gap without overlapping adjacent lines.
 */
import * as types from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as contentConstants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import type { SpaceCalculation } from "./types"

const logger = loggerModule.createLogger("styleCalculator/layout")

// Minimum visual gap between anchor text bottom and tooltip top (px)
const UI_SPACING_PX = 3
// Tooltip font must not exceed this fraction of the original font size
const MAX_FONT_RATIO = 0.8
// Rects within this many pixels of the container bottom are treated as "last line"
const LAST_LINE_EPSILON_PX = 1.5

/** Returns `true` if the element is an H1–H6 heading tag. */
function isHeadingElement(el: HTMLElement | null): boolean {
    if (!el) return false
    const tag = el.tagName?.toUpperCase()
    return tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6"
}

/**
 * Returns `true` when the anchor's last client rect sits at or below the container's
 * bottom edge (within `LAST_LINE_EPSILON_PX`), meaning the selection is on the final
 * line of the container — relevant for heading margin-bottom optimisation.
 */
function isSelectionOnLastLine(anchor: HTMLElement | null, container: HTMLElement | null): boolean {
    if (!anchor || !container) return false
    const rects = anchor.getClientRects()
    if (!rects || rects.length === 0) return false
    const lastRect = rects[rects.length - 1] as DOMRect | ClientRect | undefined
    if (!lastRect) return false
    const containerBottom = container.getBoundingClientRect().bottom
    return containerBottom - lastRect.bottom <= LAST_LINE_EPSILON_PX
}

/**
 * Calculates the optimal tooltip font size that fits inside the available line spacing
 * without overlapping adjacent text lines.
 *
 * The algorithm:
 * 1. Measures available vertical space from the line-height gap (or heading margin-bottom).
 * 2. Subtracts a safety delta and the user-configured gap preference.
 * 3. Clamps the result between `minFontSize` and `MAX_FONT_RATIO × originalFontSize`.
 *
 * @param originalElement - The element containing the selected text.
 * @param originalFontSize - The font size of that element (px).
 * @param anchor - The wrapped anchor element (used for last-line detection on headings).
 * @param minFontSizeOverride - Overrides the module-level minimum font size constant.
 * @returns The computed font size and a detailed `SpaceCalculation` breakdown.
 */
export function calculateOptimalTranslationFontSize(
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
        // No element available — use a simple 70% heuristic as fallback
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

    // `line-height: normal` parses as NaN; browsers default it to ~1.2× font size
    if (isNaN(lineHeight)) {
        lineHeight = originalFontSize * 1.2
    }

    const lineSpacing = lineHeight - originalFontSize
    // Base available space is the gap below the text within a single line
    let availableSpace = lineSpacing - UI_SPACING_PX

    // For headings on their last line, prefer margin-bottom over line-gap —
    // it usually provides more vertical room for the tooltip
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

    const maxFontSize = originalFontSize * MAX_FONT_RATIO
    const safetyDelta = contentConstants.MIN_TOOLTIP_SAFETY_DELTA_PX
    const effectiveAvailable = Math.max(availableSpace - safetyDelta - desiredGap, 0)

    const translationFontSize = Math.max(Math.min(effectiveAvailable, maxFontSize), minFontSize)

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
