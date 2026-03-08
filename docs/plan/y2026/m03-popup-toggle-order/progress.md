# m03-popup-toggle-order

**Date**: 2026-03-08  
**Status**: DONE

## What Changed

Swapped the order of two toggle items in the popup UI (`src/3_popup/index.html`):

- **Before**: `showIcon` (划词翻译) → `singleClickTranslate` (单击翻译单词)
- **After**: `singleClickTranslate` (单击翻译单词) → `showIcon` (划词翻译)

## Files Modified

- `src/3_popup/index.html` — reordered the two `<div class="setting-item">` blocks

## Notes

- Pure HTML reorder; no logic, styles, or other elements were changed.
- `index.ts` does not render these toggles dynamically, so no TS changes were needed.
