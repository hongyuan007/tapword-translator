/**
 * Color manipulation utilities for dynamic icon coloring.
 * Uses HSL color space for perceptually uniform lightening/darkening.
 */

/** Parse a hex color string (#RRGGBB) into HSL components */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
    // Strip # prefix if present
    const clean = hex.replace(/^#/, "")
    const r = parseInt(clean.substring(0, 2), 16) / 255
    const g = parseInt(clean.substring(2, 4), 16) / 255
    const b = parseInt(clean.substring(4, 6), 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    let h = 0
    let s = 0

    if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6
                break
            case g:
                h = ((b - r) / d + 2) / 6
                break
            case b:
                h = ((r - g) / d + 4) / 6
                break
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 }
}

/** Convert HSL components to a hex color string (#RRGGBB) */
export function hslToHex(h: number, s: number, l: number): string {
    const sNorm = s / 100
    const lNorm = l / 100
    const hNorm = ((h % 360) + 360) % 360

    const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
    const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1))
    const m = lNorm - c / 2

    let r = 0,
        g = 0,
        b = 0
    if (hNorm < 60) {
        r = c
        g = x
    } else if (hNorm < 120) {
        r = x
        g = c
    } else if (hNorm < 180) {
        g = c
        b = x
    } else if (hNorm < 240) {
        g = x
        b = c
    } else if (hNorm < 300) {
        r = x
        b = c
    } else {
        r = c
        b = x
    }

    const toHex = (v: number): string => {
        const hex = Math.round((v + m) * 255).toString(16)
        return hex.length === 1 ? "0" + hex : hex
    }

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Lighten a hex color by a given amount (0-1 scale, e.g. 0.12 = 12% more lightness) */
export function lightenHex(hex: string, amount: number): string {
    const { h, s, l } = hexToHsl(hex)
    return hslToHex(h, s, Math.min(100, l + amount * 100))
}

/** Darken a hex color by a given amount (0-1 scale, e.g. 0.15 = 15% less lightness) */
export function darkenHex(hex: string, amount: number): string {
    const { h, s, l } = hexToHsl(hex)
    return hslToHex(h, s, Math.max(0, l - amount * 100))
}
