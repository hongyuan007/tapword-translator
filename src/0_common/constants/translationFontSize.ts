/**
 * Translation font size presets and helpers
 */

import type { TranslationFontSizePreset } from "@/0_common/types"

export const TRANSLATION_FONT_SIZE_MAP: Record<TranslationFontSizePreset, number> = {
    small: 10,
    medium: 12,
    large: 14,
    extraLarge: 16,
}

export const DEFAULT_TRANSLATION_FONT_SIZE_PRESET: TranslationFontSizePreset = "large"

/**
 * Resolve preset to pixel size with fallback to default preset.
 */
export function getFontSizePxFromPreset(preset?: TranslationFontSizePreset): number {
    const resolvedPreset = preset ?? DEFAULT_TRANSLATION_FONT_SIZE_PRESET
    return TRANSLATION_FONT_SIZE_MAP[resolvedPreset]
}

/**
 * Resolve preset and pixel size.
 */
export function resolveTranslationFontSize(preset?: TranslationFontSizePreset): { preset: TranslationFontSizePreset; px: number } {
    const resolvedPreset = preset ?? DEFAULT_TRANSLATION_FONT_SIZE_PRESET
    const px = getFontSizePxFromPreset(resolvedPreset)
    return { preset: resolvedPreset, px }
}
