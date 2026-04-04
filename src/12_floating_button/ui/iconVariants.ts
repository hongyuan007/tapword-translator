/**
 * SVG icon variants for the floating button.
 * Each variant is a function that accepts a brand color and returns an SVG string.
 */

import type { IconVariant } from "@/12_floating_button/types"
import * as colorUtils from "@/12_floating_button/ui/colorUtils"

/** Map of icon variant identifiers to their SVG template functions */
export const ICON_VARIANTS: Record<IconVariant, (color: string) => string> = {
    // V1 — Classic Brand: tilted thin T on pink circle
    v1: (color) =>
        `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="14" fill="${color}" /><g transform="translate(14, 14) scale(0.923) translate(-14, -14)"><g transform="translate(14, 14) skewX(-16) translate(-14, -14)"><path d="M 7.5 7 L 20.5 7 L 20.5 10 L 15.75 10 L 15.75 22 L 12.25 22 L 12.25 10 L 7.5 10 Z" fill="#ffffff" /></g></g></svg>`,

    // V2 — Gradient Quality: gradient pink bg, shadow on T
    v2: (color) => {
        const light = colorUtils.lightenHex(color, 0.12)
        const dark = colorUtils.darkenHex(color, 0.15)
        const shadow = colorUtils.darkenHex(color, 0.35)
        return `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="v2-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${light}" /><stop offset="100%" stop-color="${dark}" /></linearGradient><filter id="v2-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.2" flood-color="${shadow}"/></filter></defs><circle cx="14" cy="14" r="14" fill="url(#v2-grad)" /><g transform="translate(14, 14) scale(0.923) translate(-14, -14)"><g transform="translate(14, 14) skewX(-16) translate(-14, -14)" filter="url(#v2-shadow)"><path d="M 7.5 7 L 20.5 7 L 20.5 10 L 15.75 10 L 15.75 22 L 12.25 22 L 12.25 10 L 7.5 10 Z" fill="#ffffff" /></g></g></svg>`
    },

    // V3 — Brand Circle: upright T on pink circle
    v3: (color) =>
        `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="14" fill="${color}" /><g transform="translate(14, 14) scale(0.923) translate(-14, -14)"><g transform="translate(14, 14) skewX(-16) translate(-14, -14)"><path d="M 8 8 L 20 8 L 20 10.5 L 15.5 10.5 L 15.5 22 L 12.5 22 L 12.5 10.5 L 8 10.5 Z" fill="#ffffff" /></g></g></svg>`,

    // V4 — Minimal Brand T: no background, pink T only
    v4: (color) =>
        `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14, 14) scale(0.923) translate(-14, -14)"><g transform="translate(14, 14) skewX(-16) translate(-14, -14)"><path d="M 7.5 7 L 20.5 7 L 20.5 10.5 L 15.75 10.5 L 15.75 22 L 12.25 22 L 12.25 10.5 L 7.5 10.5 Z" fill="${color}" /></g></g></svg>`,

    // V5 — AI Sparkle: pink T with star accents (gold star #FFB020 stays hardcoded)
    v5: (color) =>
        `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14, 14) scale(0.923) translate(-14, -14)"><g transform="translate(10, 16) skewX(-16) translate(-12, -16)"><path d="M 4.5 7 L 19.5 7 L 19.5 10 L 14.5 10 L 14.5 22 L 9.5 22 L 9.5 10 L 4.5 10 Z" fill="${color}" /></g><path d="M 24.5 2.5 C 24.5 4.5 26 6.5 28 6.5 C 26 6.5 24.5 8.5 24.5 10.5 C 24.5 8.5 23 6.5 21 6.5 C 23 6.5 24.5 4.5 24.5 2.5 Z" fill="${color}" /><path d="M 20 14 C 20 15.5 21 16.5 22.5 16.5 C 21 16.5 20 17.5 20 19 C 20 17.5 19 16.5 17.5 16.5 C 19 16.5 20 15.5 20 14 Z" fill="#FFB020" /></g></svg>`,

    // V6 — Brand Diagonal Combo: frame + star + T
    v6: (color) =>
        `<svg class="design-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="14" fill="${color}" /><g fill="#ffffff" transform="translate(14, 14) scale(0.97) translate(-14, -14)"><path d="M 9.69589 5.30028C9.79943 4.8999 10.368 4.89991 10.4715 5.30028L11.1086 7.76368C11.3244 8.59845 11.9396 9.27221 12.7513 9.56299L14.9019 10.3334C15.2559 10.4602 15.2559 10.9608 14.9019 11.0876L12.7513 11.8581C11.9396 12.1489 11.3244 12.8226 11.1086 13.6574L10.4715 16.1208C10.368 16.5212 9.79943 16.5212 9.69589 16.1208L9.05884 13.6574C8.84297 12.8226 8.22786 12.1489 7.41615 11.8581L5.26548 11.0876C4.91151 10.9608 4.91151 10.4602 5.26548 10.3334L7.41615 9.56299C8.22786 9.27221 8.84297 8.59844 9.05884 7.76368L9.69589 5.30028Z"/><g transform="translate(19, 17.5) skewX(-16) translate(-18.5, -17.5)"><path d="M 14.5 13 L 22.5 13 L 22.5 15.5 L 19.5 15.5 L 19.5 22.5 L 17 22.5 L 17 15.5 L 14.5 15.5 Z" /></g><path d="M7.30921 15.6381C7.53044 15.6381 7.70979 15.8175 7.70979 16.0387V19.0088C7.70979 19.934 8.45993 20.684 9.38526 20.684H11.7557C11.9769 20.684 12.1562 20.8634 12.1562 21.0846V22.152C12.1562 22.3732 11.9769 22.5526 11.7557 22.5526H9.38526C7.42782 22.5526 5.84099 20.966 5.84099 19.0088V16.0387C5.84099 15.8175 6.02034 15.6381 6.24157 15.6381H7.30921Z" /><path d="M18.0064 6.20485C19.9639 6.20485 21.5507 7.79145 21.5507 9.74861V11.281C21.5507 11.5022 21.3713 11.6816 21.1501 11.6816H20.0825C19.8612 11.6816 19.6819 11.5022 19.6819 11.281V9.74861C19.6819 8.82341 18.9318 8.07338 18.0064 8.07338H14.4343C14.2131 8.07338 14.0337 7.89403 14.0337 7.6728V6.60543C14.0337 6.3842 14.2131 6.20486 14.4343 6.20485H18.0064Z"/></g></svg>`,
}
