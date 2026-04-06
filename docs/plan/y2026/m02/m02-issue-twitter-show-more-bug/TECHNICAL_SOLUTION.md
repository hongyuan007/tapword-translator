# Solution F Technical Design — Range-Based Zero-DOM-Intrusion Architecture

> Created: 2026-03-04
> Last Updated: 2026-03-04

## 1. Requirements

### 1.1 Problem Statement

The TapWord Translator extension wraps selected text in `<span class="ai-translator-anchor">` elements to anchor translation tooltips. On SPA frameworks (React, Vue), this DOM intrusion conflicts with virtual DOM reconciliation, causing:

- **Twitter "Show More" bug**: Text duplication when React re-renders after "Show more" click
- **YouTube title bug**: Similar duplication on dynamic content updates
- **General SPA instability**: Any framework that reconciles DOM state can produce broken layouts

### 1.2 Root Cause

1. Extension wraps text node in `<span>` → Real DOM modified
2. Framework's Virtual DOM is unaware of the `<span>`
3. Framework triggers a state update (e.g., "Show more")
4. Reconciliation fails: framework can't find expected text node
5. Framework appends new text instead of updating → duplicate text visible

### 1.3 Success Criteria

- **Zero DOM intrusion**: Extension must NOT modify the page's DOM tree structure (no `extractContents`, no `insertNode`, no `<span>` wrapping)
- **Feature parity**: All existing V1 features must work — tooltip display, modal detail view, overlap detection, speech synthesis, scroll repositioning
- **Click-on-translated-text**: Single-click on translated text opens detail modal (V1 parity via anchors)
- **Overlap management**: New translations overlapping existing ones must remove the old translation
- **SPA compatibility**: Twitter, YouTube, Reddit, and other SPA pages must work without duplication bugs

---

## 2. Technical Approach

### 2.1 Core Concept: Range as Position Anchor

Replace DOM-wrapping `<span>` elements with **`Range` objects** as the position reference for translated text.

| Aspect | V1 (Anchor-based) | V2 (Range-based) |
|---|---|---|
| Position reference | `<span>.getClientRects()` | `Range.getClientRects()` |
| Data storage | Multiple `Map<anchorId, ...>` | Single `Map<id, TranslationEntry>` |
| Click handling | Per-anchor `addEventListener` | Global `document.caretRangeFromPoint` |
| Overlap detection | `document.querySelectorAll('.anchor')` | `Range.compareBoundaryPoints()` |
| Orphan detection | `document.getElementById()` | `range.startContainer.isConnected` |
| DOM mutation | `extractContents` + `insertNode` + `<span>` | None — DOM untouched |
| Underline styling | `text-decoration` on anchor `<span>` | `border-top` on tooltip element |
| Cleanup | `unwrapAnchorElement` + `parent.normalize()` | Remove tooltips + delete Map entry |

### 2.2 Key API Foundations

- **`Range.getClientRects()`**: Returns per-line `DOMRect` list with character-level precision. Functionally identical to `Element.getClientRects()` on a wrapping `<span>`.
- **`Range.cloneRange()`**: Creates a copy of the Range pointing to the same text nodes. Stored in the entry map.
- **`document.caretRangeFromPoint(x, y)`**: Returns a collapsed Range at the caret position under screen coordinates. Used for hit-testing clicks against stored Ranges.
- **`Range.compareBoundaryPoints()`**: Compares boundary positions of two Ranges. Used for overlap detection.
- **`range.startContainer.isConnected`**: Fast check for whether the Range's DOM nodes are still attached. Used for orphan detection.

### 2.3 Why Not CSS Custom Highlight API?

Initially considered, but **not required**:
- `::highlight()` doesn't support `text-underline-offset` or `cursor: pointer`
- The underline effect is achieved via `border-top` on the tooltip element instead
- `CSS.highlights` has limited browser support (Chrome 105+, no Firefox)
- The tooltip `border-top` approach provides full CSS control and is visually equivalent

---

## 3. Overall Design

### 3.1 Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│  Callers (TranslationPipeline, SpaNavigationHandler)     │
│  - Import translationDisplayV2 instead of V1             │
│  - Same public API: show/update/remove/removeAll         │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  translationDisplayV2.ts  (Core Coordinator)             │
│                                                          │
│  State:                                                  │
│  - activeTranslations: Map<id, TranslationEntry>         │
│  - rectSignatureCache, tooltipSegmentsCache              │
│  - adjustedBlocks (line-height tracker)                  │
│                                                          │
│  Lifecycle:                                              │
│  - showTranslationResult() → cloneRange + store + render │
│  - positionTooltip() → range.getClientRects() + layout   │
│  - cleanupTranslationById() → remove tooltips + map del  │
│  - ensureOrphanObserver() → MutationObserver             │
│  - ensureHitTestListeners() → attach global handlers     │
│                                                          │
│  Public exports:                                         │
│  - getActiveRanges(): Map<string, Range>                 │
│  - isPointInsideActiveTranslation(x, y): boolean         │
└────────────┬─────────────────────────────────────────────┘
             │ delegates to
             ▼
┌────────────────────────┐ ┌──────────────────────────────┐
│  tooltipLayout.ts      │ │  tooltipRenderer.ts          │
│  - getNormalizedLine   │ │  - createTooltipElement()    │
│    Rects(range)        │ │  - renderTooltipContent()    │
│  - buildRectsSignature │ │  - No anchor param           │
│  - splitTextAcrossRects│ │  - originalElement only      │
└────────────────────────┘ └──────────────────────────────┘

┌────────────────────────┐ ┌──────────────────────────────┐
│  hitTesting.ts         │ │  translationOverlapDetector  │
│  - Global click/dbl    │ │  V2.ts                       │
│  - caretRangeFromPoint │ │  - Range.compareBoundary     │
│  - rangeContainsPos()  │ │    Points() based overlap    │
│  - Debounce + grace    │ │  - No DOM queries            │
└────────────────────────┘ └──────────────────────────────┘

┌────────────────────────┐ ┌──────────────────────────────┐
│  modalPositionerV2.ts  │ │  types.ts                    │
│  - Accepts Range       │ │  - TranslationEntry interface│
│  - range.getClientRects│ │  - TranslationState          │
│  - Same positioning    │ │  - Named constants           │
│    math as V1          │ │  - DisplayUserSettings       │
└────────────────────────┘ └──────────────────────────────┘
```

### 3.2 Data Model

```typescript
interface TranslationEntry {
    id: string                        // Unique ID (e.g., "tw-1", "tw-2")
    range: Range                      // Cloned Range pointing to original text nodes
    tooltips: HTMLElement[]           // Tooltip elements appended to document.body
    translationData: TranslationDetailData  // Translation content for modal
    originalText: string              // Original selected text
    translationType: "word" | "fragment"
    creationTime: number              // Date.now() at creation — for grace period
}
```

Single `Map<string, TranslationEntry>` replaces V1's scattered state across multiple Maps (`anchorDataMap`, `anchorContextMap`, `tooltipCache`, etc.).

### 3.3 Key Flows

#### 3.3.1 Translation Creation
```
User selects text → Pipeline calls showTranslationResult(range, text, state, ...)
  1. storedRange = range.cloneRange()          // No DOM modification
  2. tooltip = createTooltipElement(id, type)
  3. document.body.appendChild(tooltip)
  4. activeTranslations.set(id, entry)
  5. positionTooltip(id)                       // range.getClientRects()
  6. ensureHitTestListeners()
  7. ensureOrphanObserver()
```

#### 3.3.2 Click on Translated Text
```
User clicks on translated text →
  1. hitTesting.handleClick(e) fires (capture phase on document)
  2. caretRangeFromPoint(e.clientX, e.clientY) → get caret position
  3. findHitTranslation(node, offset) → iterate activeTranslations
  4. rangeContainsPosition(entry.range, node, offset) → found match
  5. Grace period check (skip if < 400ms since creation + single-click mode)
  6. Debounce timer (250ms) → onTranslationClick(id)
  7. translationModal.showTranslationModal(entry.translationData, entry.range, id)
```

#### 3.3.3 Overlap Detection & Removal
```
User translates new text overlapping existing translation →
  1. detectOverlappingTranslations(newRange, getActiveRanges())
  2. For each active range: rangesOverlap(newRange, existingRange)
     - a.compareBoundaryPoints(END_TO_START, b) <= 0 → a ends before b starts → no overlap
     - a.compareBoundaryPoints(START_TO_END, b) >= 0 → a starts after b ends → no overlap
     - Otherwise → overlap detected
  3. Create new translation
  4. Remove overlapping old translations by ID
```

#### 3.3.4 Orphan Detection
```
MutationObserver fires on document.body childList/subtree →
  For each active translation:
    if (!entry.range.startContainer.isConnected) →
      cleanupTranslationById(id, "orphan")   // Range's DOM nodes removed by framework
```

#### 3.3.5 Scroll/Resize Repositioning
```
window scroll/resize event (capture, passive) →
  requestAnimationFrame → for each active translation:
    rects = entry.range.getClientRects()
    if rects visible in viewport → position tooltips
    if rects empty or out of viewport → hide tooltips
```

### 3.4 Reused V1 Modules (No Changes Needed)

| Module | Usage in V2 |
|---|---|
| `lineHeightAdjuster.ts` | `range.startContainer.parentElement` passed instead of anchor element |
| `styleCalculator.ts` | `anchor` parameter already optional — V2 passes `null` |
| `domSanitizer.ts` | Still used for TreeWalker filtering and context extraction |
| `contextExtractorV2.ts` | No anchor dependency |
| `languageDetector.ts` | No anchor dependency |
| `selectionClassifier.ts` | No anchor dependency |

---

## 4. Known Issues (Pending)

### 4.1 Click-on-Translated-Text Does Not Open Modal (High Priority)

**Symptom**: Clicking on already-translated text triggers a new translation instead of opening the detail modal. Multiple tooltips stack.

**Root cause under investigation**: Both `InputListener.handleSingleClick` (capture) and `hitTesting.handleClick` (capture) are registered on `document`. They fire in registration order. The `selectionValidator` was updated to call `isPointInsideActiveTranslation()` to block re-translation, and hit-testing should open the modal. Issue persists after build — may be a `caretRangeFromPoint` precision issue or a registration-order timing issue.

**Relevant code**:
- `selectionValidator.ts` step 3: `isPointInsideActiveTranslation(event.clientX, event.clientY)`
- `hitTesting.ts`: `handleClick` → `findHitTranslation` → `onTranslationClick`
- `translationDisplayV2.ts`: `handleTranslationClick` → `translationModal.showTranslationModal`

### 4.2 Overlap Detection Not Removing Old Translations (High Priority)

**Symptom**: Translating a word, then translating a fragment containing that word, does not remove the old word tooltip. Overlapping tooltips stack.

**Root cause under investigation**: The V2 `detectOverlappingTranslations` uses `Range.compareBoundaryPoints()` which is mathematically correct. The pipeline calls `getActiveRanges()` before creating the new translation, then removes overlapping IDs. Issue persists after build — may be a Range reference invalidation issue or pipeline flow problem.

**Relevant code**:
- `translationOverlapDetectorV2.ts`: `rangesOverlap()` via `compareBoundaryPoints`
- `TranslationPipeline.ts`: `translateWordPath` / `translateFragmentPath` overlap handling
- `translationDisplayV2.ts`: `getActiveRanges()`, `removeTranslationResult()`

---

## 5. V2 File Inventory

### 5.1 New Files (7)

| File | Lines | Purpose |
|---|---|---|
| `src/1_content/ui/translationDisplayV2.ts` | ~670 | Core coordinator — lifecycle, state, public API |
| `src/1_content/ui/translationDisplayV2/types.ts` | 101 | `TranslationEntry`, `TranslationState`, named constants |
| `src/1_content/ui/translationDisplayV2/tooltipLayout.ts` | 156 | `getNormalizedLineRects(range)`, rect signature, text splitting |
| `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` | 223 | Tooltip DOM creation — no anchor param |
| `src/1_content/ui/translationDisplayV2/hitTesting.ts` | ~187 | Global click/dblclick via `caretRangeFromPoint` |
| `src/1_content/handlers/utils/translationOverlapDetectorV2.ts` | 68 | Range-vs-Range overlap detection |
| `src/1_content/utils/modalPositionerV2.ts` | 160 | Modal positioning accepting Range instead of HTMLElement |

### 5.2 Modified Files (7)

| File | Changes |
|---|---|
| `TranslationPipeline.ts` | Import V2 modules; V2 overlap detection API |
| `SpaNavigationHandler.ts` | Import V2 module |
| `translationModal.ts` | Accept `Range \| HTMLElement \| null`; dual positioner; V2 outside-click |
| `InputListener.ts` | `.ANCHOR` check → `.TOOLTIP` check |
| `content.css` | Added `border-top` to `.ai-translator-tooltip` + fragment variant |
| `selectionValidator.ts` | Removed `.ANCHOR` from `closest()`; added `isPointInsideActiveTranslation` |
| `hitTesting.ts` | Exported `rangeContainsPosition` for reuse by coordinator |

### 5.3 V1 Files Preserved (Not Modified)

| File | Status |
|---|---|
| `translationDisplay.ts` | Kept — rollback target |
| `translationDisplay/*.ts` | Kept — V1 helpers |
| `modalPositioner.ts` | Kept — still imported as fallback |
| `translationOverlapDetector.ts` | Kept — V1 overlap detector |

---

## 6. Rollback Strategy

Since V1 files are untouched, rollback is a 3-step process:
1. Revert import changes in modified files (TranslationPipeline, SpaNavigationHandler, translationModal, InputListener, selectionValidator)
2. Revert CSS changes in `content.css`
3. Delete all `*V2*` files
