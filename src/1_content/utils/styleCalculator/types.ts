/**
 * @file types.ts
 * Shared type definitions for the styleCalculator module.
 * Consumed by colors.ts, dom.ts, layout.ts, and the public facade (styleCalculator.ts).
 */

/** Internal RGBA color representation with a normalized alpha channel (0–1). */
export interface RgbaColor {
    r: number
    g: number
    b: number
    a: number
}

/** Detailed breakdown of the line-height space calculation used to derive tooltip font size. */
export interface SpaceCalculation {
    originalFontSize: number
    lineHeight: number
    lineSpacing: number
    availableSpace: number
    requiredFontSize: number
    minFontSize: number
    maxFontSize: number
}

/** Complete style result returned to tooltip rendering consumers. */
export interface TooltipStyle {
    fontSize: number
    color: string
    spaceCalculation?: SpaceCalculation
}
