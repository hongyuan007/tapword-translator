# Solution F Implementation Plan — V2 File Strategy

> Created: 2026-03-04  
> Last Updated: 2026-03-04

## Progress Tracker

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — New helper modules (6 files) | ✅ Complete | All compile clean |
| Phase 2 — Core coordinator (translationDisplayV2.ts) | ✅ Complete | 645 lines, all compile clean |
| Phase 3 — Switch callers + CSS | ✅ Complete | 5 existing files modified |
| Manual testing | ⬜ Not started | Needs browser testing on Twitter, YouTube, Reddit |

### Files Created (7 new)
- `src/1_content/ui/translationDisplayV2.ts` (645 lines)
- `src/1_content/ui/translationDisplayV2/types.ts` (101 lines)
- `src/1_content/ui/translationDisplayV2/tooltipLayout.ts` (156 lines)
- `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` (223 lines)
- `src/1_content/ui/translationDisplayV2/hitTesting.ts` (186 lines)
- `src/1_content/handlers/utils/translationOverlapDetectorV2.ts` (67 lines)
- `src/1_content/utils/modalPositionerV2.ts` (160 lines)

### Files Modified (5 existing)
- `src/1_content/handlers/TranslationPipeline.ts` — switched to V2 imports + overlap API
- `src/1_content/handlers/SpaNavigationHandler.ts` — switched to V2 import
- `src/1_content/ui/translationModal.ts` — accept `Range | HTMLElement | null`, dual positioner
- `src/1_content/handlers/InputListener.ts` — replaced `.ANCHOR` check with `.TOOLTIP`
- `src/1_content/resources/content.css` — added tooltip `border-top` + fragment variant

## 1. Core Idea

Create new `V2` files alongside existing ones. Callers switch imports to V2. Old files are untouched and can be deleted once V2 is stable and verified.

## 2. V2 File Structure Tree

```
src/1_content/
├── ui/
│   ├── translationDisplay.ts                    # OLD — keep, do not modify
│   ├── translationDisplay/                      # OLD — keep, do not modify
│   │   ├── types.ts
│   │   ├── tooltipLayout.ts
│   │   └── tooltipRenderer.ts
│   │
│   ├── translationDisplayV2.ts                  # NEW — core coordinator (Range-based)
│   └── translationDisplayV2/                    # NEW — v2 helper modules
│       ├── types.ts                             # NEW — TranslationEntry, constants
│       ├── tooltipLayout.ts                     # NEW — getNormalizedLineRectsFromRange()
│       ├── tooltipRenderer.ts                   # NEW — remove anchor param dependency
│       └── hitTesting.ts                        # NEW — caretRangeFromPoint click/dblclick
│
├── utils/
│   ├── modalPositioner.ts                       # OLD — keep
│   ├── modalPositionerV2.ts                     # NEW — accept Range instead of HTMLElement
│   ├── lineHeightAdjuster.ts                    # OLD — keep (reuse as-is)
│   ├── domSanitizer.ts                          # OLD — keep (still used by other modules)
│   ├── styleCalculator.ts                       # NO CHANGE — already anchor-optional
│   └── styleCalculator/
│       └── layout.ts                            # NO CHANGE — anchor param already optional
│
├── handlers/
│   └── utils/
│       ├── translationOverlapDetector.ts        # OLD — keep
│       └── translationOverlapDetectorV2.ts      # NEW — Range-vs-Range overlap detection
```

## 3. New File Responsibilities

### 3.1 `translationDisplayV2.ts` (core coordinator, rewrite ~700 lines)

The main coordinator. Owns all shared mutable state and orchestrates the full lifecycle.

**Key changes from V1:**

- **Data structure**: single `Map<string, TranslationEntry>` replaces multiple Maps

```typescript
interface TranslationEntry {
    range: Range                      // Live reference to original text nodes
    tooltips: HTMLElement[]           // Tooltip elements (appended to document.body)
    translationData: TranslationDetailData
    originalText: string              // For overlap detection and modal display
}
const activeTranslations = new Map<string, TranslationEntry>()
```

- **`showTranslationResult()`**: No more `extractContents()` / `insertNode()` / `<span>` creation. Just `range.cloneRange()` + store in Map + create tooltips
- **`positionTooltip()`**: `entry.range.getClientRects()` replaces `anchor.getClientRects()`
- **`cleanupTranslationById()`**: No more `unwrapAnchorElement()` / `parent.normalize()`. Just remove tooltips + delete from Map
- **Orphan detection**: `range.startContainer.isConnected === false` replaces `document.getElementById() === null`
- **IntersectionObserver**: Removed. Replaced by rect-vs-viewport check inside `positionTooltip()` rAF loop
- **Click/dblclick**: Delegated to `hitTesting.ts` (global listeners)

**Public API preserved (same function signatures for callers):**
- `showTranslationResult(range, selectedText, state, context, onRefresh, translationType, userSettings): string`
- `updateTranslationResult(translationId, state, userSettings): void`
- `removeTranslationResult(translationId): void`
- `removeAllTranslationResults(): void`

### 3.2 `translationDisplayV2/types.ts` (~80 lines)

- Copy `TranslationState`, `DisplayUserSettings`, constants from V1
- Add `TranslationEntry` interface
- Remove anchor-specific constants if any

### 3.3 `translationDisplayV2/tooltipLayout.ts` (~160 lines)

- `getNormalizedLineRectsFromRange(range: Range): DOMRect[]` — same line-grouping logic, input changes from `HTMLElement` to `Range`
- `buildRectsSignature()` — unchanged
- `splitTextAcrossRects()` — unchanged

### 3.4 `translationDisplayV2/tooltipRenderer.ts` (~200 lines)

- `renderTooltipContent()` — remove `anchor` parameter, use `originalElement` only for style calculation
- Rest unchanged (spinner, truncation, font sizing, etc.)

### 3.5 `translationDisplayV2/hitTesting.ts` (~120 lines, entirely new)

Global click/dblclick handler using `caretRangeFromPoint`:

```typescript
// Registers global document listeners (capture phase)
export function attachGlobalHitListeners(
    getActiveRanges: () => Map<string, Range>,
    onTranslationClick: (id: string) => void,
    onTranslationDblClick: (id: string) => void
): void

// Detaches listeners (called when all translations are removed)
export function detachGlobalHitListeners(): void

// Core hit-test: checks if a caret position falls within any active range
function findHitTranslation(
    caretNode: Node, caretOffset: number,
    activeRanges: Map<string, Range>
): string | null
```

Core algorithm:
1. On click → `document.caretRangeFromPoint(e.clientX, e.clientY)` → get caret position
2. Iterate all active ranges → `rangeContainsPosition(translationRange, caretNode, caretOffset)`
3. If matched → dispatch to `onTranslationClick(id)` or `onTranslationDblClick(id)`

Includes debounce timer (`CLICK_DEBOUNCE_DELAY_MS = 250ms`) and creation grace period (`INTERACTION_GRACE_PERIOD_MS = 400ms`) logic, matching V1 behavior.

### 3.6 `modalPositionerV2.ts` (~160 lines)

- `ModalPositionerV2.compute(range: Range, modalRect, translationType)` instead of `(anchorElement: HTMLElement, ...)`
- `getTopBottomRects()` uses `range.getClientRects()` instead of `element.getClientRects()`
- All positioning math identical to V1

### 3.7 `translationOverlapDetectorV2.ts` (~80 lines)

- `detectOverlappingTranslations(range: Range, activeRanges: Map<string, Range>): string[]`
- Uses `Range.compareBoundaryPoints()` for Range-vs-Range intersection detection
- No DOM queries for `.ai-translator-anchor` elements

## 4. Caller Import Changes (Existing files to modify)

| File | Current Import | New Import |
|---|---|---|
| `src/1_content/handlers/TranslationPipeline.ts` | `translationDisplay` | `translationDisplayV2` |
| `src/1_content/handlers/TranslationPipeline.ts` | `translationOverlapDetector` | `translationOverlapDetectorV2` |
| `src/1_content/handlers/SpaNavigationHandler.ts` | `translationDisplay` | `translationDisplayV2` |
| `src/1_content/ui/translationModal.ts` | `ModalPositioner` from `modalPositioner` | `ModalPositionerV2` from `modalPositionerV2` |
| `src/1_content/resources/content.css` | `.ai-translator-anchor` styles | Add tooltip `border-top`, optionally remove anchor styles |

## 5. Files NOT Needing V2 (Reuse As-Is)

| File | Reason |
|---|---|
| `lineHeightAdjuster.ts` | `findNearestBlockAncestor()` accepts `HTMLElement`; V2 passes `range.startContainer.parentElement` |
| `styleCalculator.ts` + sub-folder | `calculateTooltipStyle(originalElement, anchor?, ...)` — `anchor` is already optional; V2 passes `null` |
| `domSanitizer.ts` | Still needed for TreeWalker filtering, context extraction. Anchor-filtering code is harmless |
| `contextExtractorV2.ts` | No anchor dependency |
| All `handlers/utils/` except `translationOverlapDetector` | No anchor dependency |

## 6. CSS Changes (`src/1_content/resources/content.css`)

```css
/* REMOVE (or leave as dead code until V1 is deleted): */
.ai-translator-anchor { ... }
.ai-translator-anchor--word { ... }

/* ADD tooltip border-top for visual underline effect: */
.ai-translator-tooltip {
    border-top: 1.5px solid var(--modal-blue-accent-color);  /* word default */
}
.ai-translator-tooltip--fragment {
    border-top-color: var(--modal-accent-color);              /* fragment override */
}
```

## 7. Migration Phases & Dependency Graph

```
Phase 1 (Independent, no caller changes):
  ├── translationDisplayV2/types.ts
  ├── translationDisplayV2/tooltipLayout.ts
  ├── translationDisplayV2/tooltipRenderer.ts
  ├── translationDisplayV2/hitTesting.ts
  ├── translationOverlapDetectorV2.ts
  └── modalPositionerV2.ts

Phase 2 (Depends on Phase 1):
  └── translationDisplayV2.ts   ← orchestrates all Phase 1 modules

Phase 3 (Switch callers):
  ├── TranslationPipeline.ts    → import translationDisplayV2 + translationOverlapDetectorV2
  ├── SpaNavigationHandler.ts   → import translationDisplayV2
  ├── translationModal.ts       → import ModalPositionerV2
  └── content.css               → add border-top, optionally remove anchor styles
```

## 8. Effort Estimate

| Phase | Files | Effort |
|---|---|---|
| Phase 1 — New helper modules | 6 new files | ~1 day |
| Phase 2 — Core coordinator | 1 new file (`translationDisplayV2.ts`) | ~1 day |
| Phase 3 — Switch callers + CSS | 4 existing files modified | ~0.5 day |
| Manual testing (Twitter, Reddit, YouTube, etc.) | — | ~0.5–1 day |
| **Total** | **7 new + 4 modified** | **~3–3.5 days** |

## 9. Rollback Strategy

Since V1 files are untouched, rollback is a simple 3-step process:
1. Revert import changes in `TranslationPipeline.ts`, `SpaNavigationHandler.ts`, `translationModal.ts`
2. Revert CSS changes in `content.css`
3. Delete all `*V2*` files

No data migration required. No schema changes. Zero risk to V1 stability.
