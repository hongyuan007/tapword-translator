# Issue #35 Fix Analysis — Tooltip Scroll Drift

## Problem

On pages where `<body>` acts as an independent scroll container (e.g. `developers.openai.com/codex`),
the floating translation tooltip drifts upward as the user scrolls, eventually detaching from its anchor word.

## Root Cause

The tooltip is appended to `document.body` with `position: absolute`.  
Its `top` coordinate is computed in `positionTooltip()`:

```typescript
// Before fix
const scrollY = window.scrollY || document.documentElement.scrollTop || 0
const top = rect.bottom + scrollY + verticalOffset
```

This formula converts viewport-relative coordinates (`rect.bottom` from `getBoundingClientRect()`)
to document-absolute coordinates by adding the window's scroll offset.

**This breaks when `<body>` is the scroll container**, which is a common layout pattern used by
OpenAI Docs and many Next.js / SPA documentation sites:

```css
body {
  position: relative;   /* ← makes body the positioned ancestor for absolute children */
  overflow-y: auto;     /* ← body itself is the scroll container */
}
```

In this layout:
- `window.scrollY` stays **0** throughout (the window/viewport never scrolls)
- `document.body.scrollTop` accumulates the scroll amount
- The tooltip is absolutely positioned relative to `body`
- `top: X` means "X px from body's content origin" — and body's content origin moves up as it scrolls

**Result**: On every scroll step, `positionTooltip` recalculates with `scrollY = 0`,
producing a `top` that decreases proportionally with `rect.bottom` — the tooltip drifts upward.

### Debug Log Evidence

```
# Before scroll (body.scrollTop = 0)
anchorRect.bottom = 216.5  window.scrollY = 0
→ css top = 219.5px  ✓ (correct)

# After 80px scroll (body.scrollTop = 80, window.scrollY still = 0)  
anchorRect.bottom = 136.5  window.scrollY = 0
→ css top = 139.5px  ✗ (should be 219.5px)
   viewport position of tooltip = 139.5 - 80 = 59.5px (above anchor at 136.5px!)
```

## Fix

Include `document.body.scrollTop` / `scrollLeft` in the scroll offset:

```typescript
// After fix (src/1_content/ui/translationDisplay.ts)
const scrollX = (window.scrollX || document.documentElement.scrollLeft || 0) + (document.body?.scrollLeft || 0)
const scrollY = (window.scrollY || document.documentElement.scrollTop  || 0) + (document.body?.scrollTop  || 0)
```

### Why this is safe

| Page type | `window.scrollY` | `body.scrollTop` | Sum (correct) |
|---|---|---|---|
| Normal window-scroll | > 0 | 0 | `window.scrollY` ✓ |
| Body-scroll (OpenAI, SPA) | 0 | > 0 | `body.scrollTop` ✓ |
| Inner `<div>` scroll | 0 | 0 | 0 ✓ (inner-div tooltips use IntersectionObserver separately) |

### Verification

After the fix, `css top` stays constant at `219.5px` across all scroll steps:

```
step 0: rect.bottom=216.5  scrollY=  0  → top=219.5  ✓
step 1: rect.bottom=136.5  scrollY= 80  → top=219.5  ✓
step 2: rect.bottom= 56.5  scrollY=160  → top=219.5  ✓
step 3: rect.bottom=-23.5  scrollY=240  → top=219.5  ✓
```

Both E2E tests pass:
- `issue-35-scroll-drift.spec.ts` [window scroll] — `verticalGap=3` stable ✓  
- `issue-35-scroll-drift.spec.ts` [container scroll] — `verticalGap=3` stable ✓

## Files Changed

| File | Change |
|---|---|
| `src/1_content/ui/translationDisplay.ts` | Add `document.body.scrollTop/Left` to scroll offset in `positionTooltip()` |
