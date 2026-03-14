/**
 * @file tooltipLayout.ts
 * Pure utility functions for computing how a translation string should be distributed
 * across one or more visual lines of a multi-line text selection.
 *
 * V2 variant: accepts `Range` instead of `HTMLElement` for rect collection,
 * enabling zero-DOM-intrusion architecture.
 *
 * All functions here are side-effect-free and do not access the DOM beyond
 * canvas-based font measurement (`textTruncator`).
 */

import * as textTruncator from "@/0_common/utils/textTruncator"
import { LINE_GROUP_EPSILON_PX, RECT_SIGNATURE_ROUND_PX } from "./types"

// ============================================================================
// Rect Helpers
// ============================================================================

/**
 * Collapse all DOMRects from a Range into one merged rect per visual line.
 * Multiple rects on the same line (e.g. from inline elements) are unioned together.
 *
 * @param range - The Range whose client rects should be normalised.
 * @returns One `DOMRect` per distinct visual line, sorted top-to-bottom.
 */
export function getNormalizedLineRects(range: Range): DOMRect[] {
    const rects = Array.from(range.getClientRects())
        .filter((r) => r && r.width > 0 && r.height > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left)

    type LineAccumulator = { top: number; bottom: number; left: number; right: number }
    const lines: LineAccumulator[] = []

    for (const r of rects) {
        const existing = lines.find((l) => Math.abs(l.top - r.top) <= LINE_GROUP_EPSILON_PX)
        if (!existing) {
            lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
            continue
        }

        existing.top = Math.min(existing.top, r.top)
        existing.bottom = Math.max(existing.bottom, r.bottom)
        existing.left = Math.min(existing.left, r.left)
        existing.right = Math.max(existing.right, r.right)
    }

    return lines.map((l) => new DOMRect(l.left, l.top, Math.max(0, l.right - l.left), Math.max(0, l.bottom - l.top)))
}

/**
 * Build a stable string signature from a set of line rects.
 * The signature changes only when line positions or widths shift by more than
 * `RECT_SIGNATURE_ROUND_PX`, preventing redundant re-splits on sub-pixel scroll jitter.
 *
 * @param rects - The normalised line rects to encode.
 * @returns A pipe-separated string encoding rounded left, top, and width for each rect.
 */
export function buildRectsSignature(rects: DOMRect[]): string {
    return rects
        .map((r) => {
            const left = Math.round((r.left || 0) / RECT_SIGNATURE_ROUND_PX)
            const top = Math.round((r.top || 0) / RECT_SIGNATURE_ROUND_PX)
            const width = Math.round((r.width || 0) / RECT_SIGNATURE_ROUND_PX)
            return `${left},${top},${width}`
        })
        .join("|")
}

// ============================================================================
// Text Splitting
// ============================================================================

/**
 * Distribute `fullText` across multiple line widths so each tooltip segment
 * receives the longest prefix that visually fits its corresponding line.
 *
 * The last line always receives the remaining text; CSS fade-out masks any overflow.
 *
 * @param fullText - The full translation string to distribute.
 * @param rectWidths - Available pixel width for each tooltip segment (one per line).
 * @param elementForFont - A DOM element whose computed font is used for measurement.
 * @returns An array of text segments, one per entry in `rectWidths`.
 */
export function splitTextAcrossRects(fullText: string, rectWidths: number[], elementForFont: HTMLElement): string[] {
    const font = textTruncator.getFontShorthandFromElement(elementForFont)
    const segments: string[] = []

    let remaining = fullText
    for (let i = 0; i < rectWidths.length; i++) {
        const width = rectWidths[i] || 0
        const isLast = i === rectWidths.length - 1

        if (!remaining) break

        if (isLast) {
            // Last line takes whatever remains; CSS handles overflow via fade mask.
            segments.push(remaining)
            continue
        }

        const prefix = longestPrefixThatFits(remaining, width, font)
        segments.push(prefix)
        remaining = remaining.slice(prefix.length).trimStart()
    }

    return segments
}

/**
 * Find the longest prefix of `text` whose rendered width fits within `maxWidthPx`.
 * Snaps back to the nearest word boundary when possible to avoid splitting words mid-glyph.
 *
 * @param text - Source text to search.
 * @param maxWidthPx - Maximum allowed rendered width in pixels.
 * @param font - CSS font shorthand string used for canvas measurement.
 * @returns The longest fitting prefix (may be shorter than `text`).
 */
export function longestPrefixThatFits(text: string, maxWidthPx: number, font: string): string {
    if (maxWidthPx <= 0 || !text) return ""

    // Fast path: whole text fits.
    if (textTruncator.measureTextWidth(text, font) <= maxWidthPx) {
        return text
    }

    let lo = 0
    let hi = text.length
    let best = 0

    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const candidate = text.slice(0, mid)
        const w = textTruncator.measureTextWidth(candidate, font)
        if (w <= maxWidthPx) {
            best = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }

    const raw = text.slice(0, best)
    const lastSpace = Math.max(raw.lastIndexOf(" "), raw.lastIndexOf("\n"), raw.lastIndexOf("\t"))

    // Snap back to a word boundary only if it leaves a meaningful prefix (>=8 chars)
    // and the snapped width still uses at least 98% of available space.
    if (lastSpace >= 8) {
        const snapped = raw.slice(0, lastSpace)
        if (textTruncator.measureTextWidth(snapped, font) >= maxWidthPx * 0.98) {
            return snapped
        }
    }

    return raw
}
