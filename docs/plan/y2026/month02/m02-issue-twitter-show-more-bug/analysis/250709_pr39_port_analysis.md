# PR #39 (v0.4.2) Port Analysis for V2 Tooltip Branch

**Date**: 2026-03-11  
**Branch**: `feat/260307/tooltip-v2`  
**PR**: #39 (release v0.4.2 merged into `main`)

## Summary

| Fix | Description | Status |
|-----|-------------|--------|
| Fix 1 | Scroll offset for body-scroll pages | **NEEDS PORTING** |
| Fix 2 | Tooltip resync after line-height shift | **NEEDS PORTING** |
| Fix 3 | `all_frames` manifest change | ALREADY PRESENT |
| Fix 4 | Language detection improvements | ALREADY PRESENT |
| Fix 5 | Language disambiguation (zh/ja) | ALREADY PRESENT |
| Fix 6 | JWT token pre-warm | ALREADY PRESENT |

---

## Detailed Analysis

### Fix 1: Scroll offset for body-scroll pages (PR #37) — NEEDS PORTING

**Problem**: On body-scroll pages (e.g. `position:relative + overflow-y:auto` on `<body>`), `window.scrollY` stays `0` while `document.body.scrollTop` accumulates. Tooltips positioned with bare `window.scrollY` are placed at incorrect y-offsets.

**V1 fix** (`translationDisplay.ts` lines 234–237):
```typescript
const winScrollX = window.scrollX || document.documentElement.scrollLeft || 0
const winScrollY = window.scrollY || document.documentElement.scrollTop  || 0
const scrollX = winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0)
const scrollY = winScrollY + (winScrollY === 0 ? (document.body?.scrollTop  || 0) : 0)
```

**V2 current code** (`translationDisplayV2.ts` lines 292–293):
```typescript
const scrollX = window.scrollX || document.documentElement.scrollLeft || 0
const scrollY = window.scrollY || document.documentElement.scrollTop || 0
```

**Issue**: V2 is missing the `document.body.scrollTop/scrollLeft` fallback. The `||` chain only falls back to `document.documentElement`, not `document.body`. On body-scroll pages, all three (`window.scrollY`, `document.documentElement.scrollTop`, and `0`) resolve to `0`, causing tooltips to be positioned incorrectly.

**`iconManager.ts`**: Already has the full fix (lines 50–55). No action needed.

**Action Required**: Add `document.body.scrollTop/scrollLeft` fallback to `translationDisplayV2.ts` `positionTooltip()`, matching the V1 pattern.

---

### Fix 2: Tooltip resync after line-height shift (PR #40) — NEEDS PORTING

**Problem**: When translating a word in an upper paragraph triggers a `line-height` adjustment (to make room for the tooltip), all lower paragraphs shift down. Existing tooltips on those lower paragraphs retain stale positions until the next scroll/resize event.

**V1 fix** (`translationDisplay.ts` lines 671–686):
```typescript
const adjustmentResult = lineHeightAdjuster.adjustLineHeightIfNeeded(anchor, styleResult.spaceCalculation)
if (adjustmentResult.blockElement) {
    anchorAdjustedBlocks.set(anchorId, adjustmentResult.blockElement)
}
didAdjustLineHeight = adjustmentResult.didAdjustLineHeight
// ...
if (didAdjustLineHeight) {
    scheduleReposition()   // <-- resync ALL tooltip positions
}
```

**V2 current code** (`translationDisplayV2.ts` lines 562–569):
```typescript
const adjustmentResult = lineHeightAdjuster.adjustLineHeightIfNeeded(parentElement, styleResult.spaceCalculation)
if (adjustmentResult.blockElement) {
    adjustedBlocks.set(id, adjustmentResult.blockElement)
}
// ← No didAdjustLineHeight check, no scheduleReposition() call
```

**Issue**: V2 stores the block element but never reads `adjustmentResult.didAdjustLineHeight` and never calls `scheduleReposition()`. The `scheduleReposition()` function already exists in V2 (line 84), so the infrastructure is in place — it just needs to be wired up.

**Action Required**: After the `adjustLineHeightIfNeeded()` call in `showTranslationResult()`, capture `didAdjustLineHeight` and call `scheduleReposition()` when true. Mirror the V1 pattern.

---

### Fix 3: `all_frames` manifest change — ALREADY PRESENT

`src/manifest.json` line 35 already contains:
```json
"all_frames": true
```

No action needed.

---

### Fix 4: Language detection improvements (PR #38) — ALREADY PRESENT

All three sub-fixes from PR #38 are present on the current branch:

1. **Block-level paragraph detection**: `TranslationPipeline.ts` line 130 uses `domSanitizer.getSurroundingTextForDetection(range, 150)` for block context instead of selected word alone.
2. **Short ASCII fast-path**: `languageDetector.ts` lines 15–45 have `SHORT_ASCII_THRESHOLD = 10` and `PRINTABLE_ASCII_REGEX` with early-return for short ASCII text.
3. **Single `detectSourceLanguageAsync` call**: `TranslationPipeline.ts` calls it once at line 130 and reuses both `detectedLang` and `blockContextLang` throughout routing.

No action needed.

---

### Fix 5: Language disambiguation (zh/ja) — ALREADY PRESENT

`languageValidator.ts` already contains the full native-language suppression heuristics:

- **zh target**: Han ratio check with Kana exception (lines 78–127), `CHINESE_RATIO_THRESHOLD = 0.05`, `CONTEXT_CHINESE_RATIO_THRESHOLD = 0.10`, page-declared language check, context Chinese-dominance check.
- **ja target**: Kana presence check (lines 132–136).
- **ko target**: Hangul check (lines 140–144).
- **ru target**: Cyrillic check (lines 148–152).
- **Fallback**: Page lang attribute + async detection for other languages (lines 156–172).

No action needed.

---

### Fix 6: JWT token pre-warm (PR #34) — ALREADY PRESENT

All components are in place:

- `src/1_content/index.ts` line 88: Fires `PAGE_ACTIVATED` message on content script init.
- `src/2_background/handlers/TokenWarmUpHandler.ts`: Handles the message and pre-warms the JWT token.
- `src/2_background/messaging/MessageRouter.ts` line 61: Routes `PAGE_ACTIVATED` to the handler.
- `src/0_common/types/index.ts`: Defines `PageActivatedMessage` type.

No action needed.

---

## Porting Checklist

- [ ] **Fix 1**: Add `document.body.scrollTop/scrollLeft` fallback in `translationDisplayV2.ts` `positionTooltip()`
- [ ] **Fix 2**: Wire up `didAdjustLineHeight` → `scheduleReposition()` in `translationDisplayV2.ts` `showTranslationResult()`
