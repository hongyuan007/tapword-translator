# Solution F Implementation Progress

> Created: 2026-03-04
> Last Updated: 2026-03-07

## Phase Status

| Phase | Status | Description |
|---|---|---|
| Phase 1 — Helper modules (6 files) | ✅ Complete | All compile clean |
| Phase 2 — Core coordinator | ✅ Complete | 672 lines, compiles clean |
| Phase 3 — Switch callers + CSS | ✅ Complete | 7 existing files modified |
| Bug fix — selectionValidator ANCHOR removal | ✅ Complete | isPointInsideActiveTranslation guard |
| Bug fix — translationModal ANCHOR removal | ✅ Complete | V2 range-based outside-click |
| Bug fix — hitTesting export | ✅ Complete | rangeContainsPosition exported |
| Testing — Click-on-translated-text opens modal | ✅ Fixed | Rect-based hit testing (Bug A fix) |
| Bug A edge case — whitespace between words | ✅ Fixed | 4px horizontal padding on Range rects (horizontal whitespace + vertical gap coverage) |
| Bug A edge case — gap between text and tooltip | ✅ Fixed | 3-zone hit testing (Range rects + tooltip rects + gap bridging) |
| Testing — Overlap detection removes old tooltips | ✅ Fixed | Two-layer overlap detection: DOM boundary comparison + visual rect fallback via Range.getClientRects() |
| Fix — Drag-select modal trigger | ✅ Fixed | handleClick checks selection.isCollapsed to skip drag-selections |
| Fix — Double-click removal broken | ✅ Fixed | Removed incorrect selection guard from handleDblClick (double-click inherently selects word) |
| Fix — Ghost icon after double-click removal | ✅ Fixed | Endpoint-based containment check in validateSelectionAsync (start+end edges, not center points) |
| Fix — Partial overlap selection blocked | ✅ Fixed | Refined from trigger-skip to endpoint check, allowing partial overlap selections while blocking full containment |
| Fix — Tooltip width matches original text | ✅ Fixed | minWidth set to Range rect width in positionTooltip |
| Fix — Tooltip text centering | ✅ Fixed | text-align: center added to .ai-translator-tooltip CSS |
| Fix — Line-height scope (block ancestor) | ✅ Fixed | findNearestBlockAncestor checks element itself first (safe for V1 inline, correct for V2 block) |
| Manual testing — Twitter, YouTube, Reddit | ⬜ Not Started | Blocking bugs now fixed |

---

## New Files (7 files, 1,564 lines total)

### `src/1_content/ui/translationDisplayV2.ts` (672 lines)

Core coordinator that replaces `translationDisplay.ts`. Manages the full lifecycle of Range-based translations.

**Key components:**
- **Shared state**: `activeTranslations: Map<string, TranslationEntry>` — single unified registry replacing V1's multiple Maps
- **`showTranslationResult()`**: Uses `range.cloneRange()` instead of `extractContents()`/`insertNode()`. No DOM tree modification.
- **`positionTooltip()`**: Uses `entry.range.getClientRects()` to position tooltip elements. Includes viewport bounds check (replaces V1's IntersectionObserver).
- **`cleanupTranslationById()`**: Removes tooltip DOM elements and deletes Map entry. No `unwrapAnchorElement()` or `parent.normalize()`.
- **`ensureOrphanObserver()`**: MutationObserver that checks `range.startContainer.isConnected` to detect orphaned translations.
- **`ensureHitTestListeners()`**: Lazily attaches global click/dblclick handlers via hitTesting module.
- **`handleTranslationClick()`**: Opens detail modal passing `entry.range` for positioning.
- **`handleTranslationDblClick()`**: Removes translation and clears selection.
- **`getActiveRanges()`**: Returns `Map<string, Range>` for overlap detector.
- **`isPointInsideActiveTranslation(x, y)`**: Checks if a screen point falls inside any active translation Range. Used by `selectionValidator` to prevent re-translation.

**Public API (same signatures as V1 for caller compatibility):**
```typescript
showTranslationResult(range, selectedText, state, context, onRefresh, translationType, userSettings): string
updateTranslationResult(translationId, state, userSettings): void
removeTranslationResult(translationId): void
removeAllTranslationResults(): void
getActiveRanges(): Map<string, Range>
isPointInsideActiveTranslation(x: number, y: number): boolean
```

---

### `src/1_content/ui/translationDisplayV2/types.ts` (100 lines)

Shared types and named constants for the V2 system.

**Key types:**
- `TranslationEntry` — unified data structure: `{ id, range: Range, tooltips: HTMLElement[], translationData, originalText, translationType, creationTime }`
- `TranslationState` — `{ status, text?, translation?, sentenceTranslation?, ...}` (same as V1)
- `DisplayUserSettings` — `{ translationFontSizePreset, translationFontSize, autoAdjustHeight }`
- `TranslationDetailData` — context data for modal display

**Named constants (replacing V1 magic numbers):**
- `CLICK_DEBOUNCE_DELAY_MS = 250` — single-click debounce before opening modal
- `INTERACTION_GRACE_PERIOD_MS = 400` — ignore clicks on newly-created translations
- `LINE_GROUP_EPSILON_PX = 2` — tolerance for grouping rects into same line
- `VIEWPORT_PAD_PX = 8` — padding for viewport boundary checks
- `RECT_SIGNATURE_ROUND_PX = 1` — rounding precision for rect signature cache

---

### `src/1_content/ui/translationDisplayV2/tooltipLayout.ts` (156 lines)

Tooltip spatial layout calculations. Same grouping logic as V1 but accepts `Range` instead of `HTMLElement`.

**Key functions:**
- `getNormalizedLineRects(range: Range): DOMRect[]` — groups `range.getClientRects()` into per-line rects
- `buildRectsSignature(rects: DOMRect[]): string` — creates cache key from rect positions
- `splitTextAcrossRects(text: string, rects: DOMRect[]): string[]` — distributes text across line rects using `longestPrefixThatFits()` canvas measurement

---

### `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` (223 lines)

Tooltip DOM element creation and content rendering. Removed `anchor` parameter dependency.

**Key changes from V1:**
- `createTooltipElement(id, translationType)` — no anchor parameter
- `renderTooltipContent(tooltip, state, originalElement, userSettings)` — removed `anchor` param, passes `null` to `calculateTooltipStyle`
- Magic number `200` replaced with named constant `MAX_TEXT_LENGTH`
- Fragment class `.ai-translator-tooltip--fragment` added for distinct border-top color

---

### `src/1_content/ui/translationDisplayV2/hitTesting.ts` (186 lines)

Global click/dblclick handler using `document.caretRangeFromPoint` for Range-based hit testing. Replaces V1's per-anchor event listeners.

**Architecture:**
- Registers `click` and `dblclick` listeners on `document` with `{ capture: true }` (fires before page handlers)
- `HitTestCallbacks` interface decouples hit testing from coordinator state:
  - `getActiveTranslations()` — returns snapshot of ranges + creation times
  - `onTranslationClick(id)` — single click handler (opens modal)
  - `onTranslationDblClick(id)` — double click handler (removes translation)
  - `isSingleClickTranslateEnabled()` — for grace period logic
- `rangeContainsPosition(range, node, offset)` — compares boundary points to determine if a caret falls within a Range. **Exported** for reuse by coordinator's `isPointInsideActiveTranslation()`.
- `OWN_UI_SELECTOR` — skips clicks on `.ai-translator-tooltip`, `.ai-translator-icon`, `.ai-translator-modal`, `.ai-translator-modal-backdrop`
- Idempotent `attachGlobalHitListeners()` — subsequent calls update callbacks only

**Debounce behavior:**
- Single click: 250ms debounce timer, cancelled if double-click fires within window
- Double click: Immediate dispatch, cancels pending single-click timer
- Grace period: 400ms after translation creation, clicks on that translation are ignored (prevents accidental modal open during single-click-translate)

---

### `src/1_content/handlers/utils/translationOverlapDetectorV2.ts` (67 lines)

Range-vs-Range overlap detection using `Range.compareBoundaryPoints()`.

**Key function:**
```typescript
detectOverlappingTranslations(newRange: Range, activeRanges: Map<string, Range>): string[]
```

**Algorithm:** For each active range `b`, check if `newRange` `a` overlaps:
- `a.compareBoundaryPoints(END_TO_START, b) <= 0` → a ends before b starts → no overlap
- `a.compareBoundaryPoints(START_TO_END, b) >= 0` → a starts after b ends → no overlap
- Otherwise → overlap detected, add to removal list

try/catch wraps `compareBoundaryPoints` to handle detached ranges gracefully.

---

### `src/1_content/utils/modalPositionerV2.ts` (160 lines)

Modal positioning that accepts `Range` instead of `HTMLElement`.

**Key changes:**
- `ModalPositionerV2.compute(range: Range, modalRect, translationType)` — entry point
- `getTopBottomRects(range)` — uses `range.getClientRects()` with `range.getBoundingClientRect()` fallback
- All positioning math identical to V1 `ModalPositioner`

---

## Modified Files (7 files)

### `src/1_content/handlers/TranslationPipeline.ts`

**Changes:**
- Import `translationDisplayV2` instead of `translationDisplay`
- Import `translationOverlapDetectorV2` instead of `translationOverlapDetector`
- `detectOverlappingTranslations(range, translationDisplay.getActiveRanges())` — V2 API passes active ranges explicitly
- Removed V1's `while (document.getElementById(id))` dedup loop — just uses `removeTranslationResult(id)`

---

### `src/1_content/handlers/SpaNavigationHandler.ts`

**Changes:**
- Import `translationDisplayV2` instead of `translationDisplay`

---

### `src/1_content/ui/translationModal.ts`

**Changes:**
- Added import: `ModalPositionerV2` from `modalPositionerV2`
- Added import: `translationDisplayV2` (for `isPointInsideActiveTranslation`)
- `showTranslationModal(data, anchorSource: HTMLElement | Range | null, anchorId?)` — accepts both V1 HTMLElement and V2 Range
- `positionModal()` — dispatches to `ModalPositionerV2` when `anchorSource instanceof Range`, falls back to `ModalPositioner` for HTMLElement
- `handleOutsideClick()` — replaced `.ai-translator-anchor` `closest()` check with `isPointInsideActiveTranslation(event.clientX, event.clientY)` to prevent modal closing when clicking on translated text

---

### `src/1_content/handlers/InputListener.ts`

**Changes:**
- `handleDocumentClick()` — replaced `.CSS_CLASSES.ANCHOR` check with `.CSS_CLASSES.TOOLTIP` check for icon cleanup suppression

---

### `src/1_content/resources/content.css`

**Changes:**
- Added `border-top: 1.5px solid var(--modal-blue-accent-color)` to `.ai-translator-tooltip` — provides visual underline effect below original text
- Added `.ai-translator-tooltip--fragment { border-top-color: var(--modal-accent-color); }` — distinct color for fragment translations

---

### `src/1_content/handlers/utils/selectionValidator.ts`

**Changes:**
- Added import: `translationDisplayV2`
- `validateSelectionAsync()` step 8 — removed `.CSS_CLASSES.ANCHOR` from `element.closest()` selector. Added V2 Range-based check: gets first rect of selection range, calls `isPointInsideActiveTranslation()` to detect if selection falls inside an active translation
- `validateSingleClickAsync()` step 3 — removed `.CSS_CLASSES.ANCHOR` from the multi-condition `closest()` block. Added `isPointInsideActiveTranslation(event.clientX, event.clientY)` check to prevent single-click-translate from firing on already-translated text

---

### `src/1_content/ui/translationDisplayV2/hitTesting.ts` (modification to new file)

**Changes:**
- `rangeContainsPosition()` — changed from `function` to `export function` so the coordinator can reuse it in `isPointInsideActiveTranslation()`

---

## Known Bugs (Pending Investigation)

### Bug A: Click-on-Translated-Text Still Triggers New Translation

**Priority:** High
**Status:** ✅ Fixed (2026-03-06)
**Root cause:** `caretRangeFromPoint` + `rangeContainsPosition` was unreliable — tooltip text node interference, silent exceptions, sub-pixel precision issues. See `analysis/260306_bug_a_analysis.md` for full analysis.
**Fix (3 layers):**
1. **Original fix:** Replaced `caretRangeFromPoint`-based hit testing with `Range.getClientRects()` rect-based approach in both `translationDisplayV2.ts` (`isPointInsideActiveTranslation`) and `hitTesting.ts` (`handleClick`/`handleDblClick`). The new `isPointInsideRange` helper checks if a screen point falls within any of a Range's visual bounding rects — pure pixel-space comparison, no DOM node resolution needed.
2. **Horizontal whitespace fix:** 4px horizontal padding on Range rects to cover whitespace gaps between words within the same translation.
3. **Vertical gap fix:** `isPointInsideTranslationZone` with 3-zone hit testing — checks Range rects (the translated text), tooltip element rects (the translation tooltip), and vertical gap bridging (the space between text and tooltip). This ensures the cursor never enters a "dead zone" when moving from text to tooltip.

### Bug B: Overlap Detection Not Removing Old Translations

**Priority:** High
**Status:** ✅ Fixed (2026-03-06)
**Symptom:** Translating a word, then translating a fragment containing that word, leaves both tooltips visible instead of removing the old word tooltip.
**Expected behavior:** Old overlapping translation is removed when new one is created.
**Fix (two-layer strategy in `translationOverlapDetectorV2.ts`):**
1. **Layer 1 — `compareBoundaryPoints` (fast path):** Standard DOM boundary comparison for ranges within the same DOM subtree.
2. **Layer 2 — Visual rect overlap via `getClientRects` (fallback):** When `compareBoundaryPoints` throws or returns incorrect results (e.g., ranges in different DOM subtrees), falls back to checking visual bounding rect intersection.
- Logs warning when Layer 2 catches overlap that Layer 1 missed.

### Debugging Strategy

Add temporary logging at these points:
```typescript
// In translationDisplayV2.ts → isPointInsideActiveTranslation():
console.log('[V2-Debug] activeTranslations.size:', activeTranslations.size)
console.log('[V2-Debug] caretRange:', caretRange, 'result:', result)

// In translationOverlapDetectorV2.ts → rangesOverlap():
console.log('[V2-Debug] Overlap check:', { endToStart, startToEnd, result })

// In TranslationPipeline.ts → translateWordPath():
console.log('[V2-Debug] preOverlappingIds:', preOverlappingIds)
console.log('[V2-Debug] activeRanges:', translationDisplay.getActiveRanges())
```

---

## Click Debounce Optimization

`CLICK_DEBOUNCE_DELAY_MS` reduced from 250ms to 200ms for faster modal open response.

Note: Final value set to 200ms (reduced from 250ms).
