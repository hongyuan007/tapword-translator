# Code Review Report — Issue #49: Dark Background Font Color Fix

**Reviewer**: Orchestrator Agent  
**Date**: 2026-03-14  
**Manifest**: `manifest__dark-background-font-color_2026-03-14.md`  
**Type-check**: ✅ PASS (0 errors)

---

## Summary

The fix is **functionally correct** for the reported bug. Discord's white-on-dark text is now forwarded to the tooltip, and WCAG-based black/white contrast remains the fallback. The architecture (new `textColor.ts` module, `BackgroundResolutionResult` metadata, canvas-first color normalization) is clean and well-structured.

**Verdict**: Safe to test. One high-severity issue (production log noise) must be resolved before release.

---

## Issues

### 🔴 HIGH — H1: Diagnostic logs flood the production console

| Field | Value |
|---|---|
| Files | `src/1_content/utils/styleCalculator.ts`, `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` |
| Location | Last ~15 lines of `calculateTooltipStyle()` and `renderTooltipContent()` |

Both functions emit `logger.info(...)` with detailed color decision data on **every tooltip render** (loading state, success state, error state). Every translation a user makes will print ~15 lines to the DevTools console.

**Fix**: Change all investigation `logger.info` calls in these two functions to `logger.debug`. The `logger.debug` level is suppressed in production builds, so it retains utility for local debugging without noise for users.

---

### 🟡 MEDIUM — M1: `normalizeCssColor` creates a DOM probe on every render

| Field | Value |
|---|---|
| File | `src/1_content/utils/styleCalculator/textColor.ts` |
| Location | `normalizeCssColor()`, lines ~40–58 |

On each `renderTooltipContent` call, `normalizeCssColor` is invoked. The canvas path is fast, but the DOM probe fallback (`document.documentElement.appendChild(probe)` + `getComputedStyle` + `probe.remove()`) forces a synchronous reflow on the host page.

**Fix**: Memoize results with a `Map<string, string | null>`. Color strings from `getComputedStyle(element).color` repeat frequently (same element style applies to many translations).

```typescript
const normalizeCache = new Map<string, string | null>()

function normalizeCssColor(color: string | null | undefined): string | null {
    if (!color || ...) return null
    if (normalizeCache.has(color)) return normalizeCache.get(color)!
    const result = /* existing logic */
    normalizeCache.set(color, result)
    return result
}
```

---

### 🟡 MEDIUM — M2: Probe appended to `document.documentElement` instead of `document.body`

| Field | Value |
|---|---|
| File | `src/1_content/utils/styleCalculator/textColor.ts` |
| Location | `normalizeCssColor()`, line ~52 |

```typescript
document.documentElement.appendChild(probe)
```

The `<html>` element may have CSS rules (`html { color: ... }`) that affect the probe's computed color differently than `<body>`. Since the intent is to normalize an arbitrary CSS color string independent of context, appending to `<body>` is semantically safer and consistent with common testing patterns.

**Fix**: `document.body.appendChild(probe)`

---

### 🟢 LOW — L1: `syncTooltipStyles` missing `content.style.fontSize` sync

| Field | Value |
|---|---|
| File | `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` |
| Location | `syncTooltipStyles()` |

`renderTooltipContent` sets both `tooltip.style.fontSize` and `content.style.fontSize` explicitly. `syncTooltipStyles` (called for extra multi-line tooltip segments) copies `tooltip.style.fontSize` but not `content.style.fontSize`. Functionally works via CSS inheritance from the tooltip root, but is inconsistent with the explicit setter pattern.

**Fix**: Add `targetContent.style.fontSize = sourceContent.style.fontSize` in `syncTooltipStyles`.

---

### 🟢 LOW — L2: `getMonochromeColorByLuminance` docstring mismatch

| Field | Value |
|---|---|
| File | `src/1_content/utils/styleCalculator/colors.ts` |
| Location | `getMonochromeColorByLuminance()` |

The docstring says "best matches the brightness" but returns `WHITE` for `luminance >= 0.5` (i.e., copies the host's light-or-dark nature). This is intentionally different from the WCAG contrast selection in `getHighContrastColor`. The threshold (0.5) is a simplification — the true perceptual breakpoint is closer to 0.18 — but since this function is used only as a last-resort fallback when canvas and `parseColor` both fail, the practical impact is minimal.

**Fix**: Clarify the docstring to explain "approximates the host color's light/dark nature as a fallback; not a contrast calculation."

---

## Core Logic Verification

| Check | Result |
|---|---|
| Discord white text (`rgb(255,255,255)`) → tooltip text | ✅ White → boost 8% toward white → white |
| Light page black text (`rgb(0,0,0)`) → tooltip text | ✅ Black → boost 8% toward black → black |
| Fallback when host color unparseable | ✅ `getHighContrastColor` (WCAG-correct) |
| Background compositing order (outer→inner) | ✅ Correct Porter-Duff layering |
| `resolutionSource` metadata (`ancestor`/`document`/`theme`) | ✅ Clean, useful for debugging |
| `oklab`/`oklch` color format handling | ✅ Lightness component extracted correctly |
| Error state color (orange `#FF6B35`) not overwritten | ✅ Guarded by `state.status !== "error"` check |

---

## Required Actions Before Release

| Priority | Action |
|---|---|
| 🔴 Must | Change `logger.info` → `logger.debug` in `styleCalculator.ts` and `tooltipRenderer.ts` |
| 🟡 Should | Cache `normalizeCssColor` results |
| 🟡 Should | Change `documentElement.appendChild` → `document.body.appendChild` |
| 🟢 Optional | Add `targetContent.style.fontSize` to `syncTooltipStyles` |
| 🟢 Optional | Clarify `getMonochromeColorByLuminance` docstring |
