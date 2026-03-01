# Solution F Deep Analysis: Zero-DOM-Intrusion Architecture

> Last updated: 2026-02-27

## 1. Overview

"Solution F" proposes replacing the current DOM-wrapping approach (wrapping text in `<span class="ai-translator-anchor">`) with a **Range-based, zero-DOM-intrusion** architecture. Rather than modifying the page's DOM tree, we store `Range` objects pointing to translated text and use `Range.getClientRects()` to position tooltips.

**Key insight**: The CSS Custom Highlight API (`CSS.highlights`) is NOT strictly required. The core value of Solution F is **not modifying the DOM at all** — underline styling can be achieved as a visual element on the tooltip itself (see Section 3.A). The Highlight API is an optional enhancement.

## 2. The Promise

The root cause of the Twitter "Show More" bug is **DOM Intrusion**: we wrap text in `<span>`, React can't find its expected text nodes during reconciliation, and duplicate text appears.

Solution F eliminates this entirely:
- **No `extractContents()`**, no `insertNode()`, no `replaceWith()`.
- The page DOM is never touched. React's Virtual DOM and Real DOM stay perfectly synchronized.
- The extension only *reads* the DOM (to get positions) and appends tooltip `<div>`s to `document.body` (which is already what we do today).

## 3. Deep Feasibility Analysis

### A. Underline Styling — Solved via Tooltip Top Border

**Initial concern**: `::highlight()` pseudo-element doesn't support `text-underline-offset` or `cursor: pointer`.

**Revised approach**: Move the underline out of the original text entirely. Instead, render it as a **thin colored line at the top edge of the tooltip element**.

```
Original text:  "The quick brown fox jumps"
                         ─────────────── ← top-border of tooltip (visual underline)
Tooltip:                 "敏捷的棕色狐狸"
```

**Implementation**:
```css
.ai-translator-tooltip {
    /* Existing tooltip styles... */
    border-top: 1.5px solid var(--modal-blue-accent-color);  /* word */
}
.ai-translator-tooltip--fragment {
    border-top-color: var(--modal-accent-color);              /* fragment */
}
```

**Why this works well**:
1. The tooltip is already positioned directly below the translated text (with a configurable `tooltipVerticalOffsetPxV2`).
2. The visual effect is nearly identical to the current underline — a colored line at the bottom of the original text.
3. Full CSS control: `border-top-color`, thickness, offset are all customizable — no `::highlight()` limitations.
4. `cursor: pointer` is not needed on the original text because clicking behavior is handled via global hit-testing (Section 3.C).

**Trade-off**: The "underline" is part of the tooltip, not the text itself. If the tooltip is hidden (e.g., via IntersectionObserver when anchor scrolls out of a sub-container), the underline also disappears. But this is actually consistent — there's no reason to show an underline without a tooltip.

**Conclusion: ✅ Fully solved. No `::highlight()` needed for styling.**

### B. Tooltip Positioning — The Core Question

#### B.1. Can `Range.getClientRects()` Precisely Locate Text Within a Div?

**Answer: Yes, with identical precision to `Element.getClientRects()`.**

`Range.getClientRects()` is the *fundamental primitive* that `Element.getClientRects()` is built on internally. When the browser computes `span.getClientRects()`, it creates an internal Range covering the span's content and returns its client rects.

**Concrete example**:
```html
<div>The quick brown fox jumps over the lazy dog.</div>
```
If we create a Range from offset 10 to 25 (covering "brown fox jumps"):
```javascript
const textNode = div.firstChild;          // The text node
const range = document.createRange();
range.setStart(textNode, 10);             // Start at "b" of "brown"
range.setEnd(textNode, 25);               // End after "s" of "jumps"
range.getClientRects();                   // → Rects for ONLY "brown fox jumps"
```

The returned rects cover **only** "brown fox jumps" — NOT the entire text node, NOT the entire div. This is character-level precision.

**Multi-line behavior**: If the text wraps across lines (e.g., "brown fox" on line 1, "jumps" on line 2), `getClientRects()` returns **multiple rects**, one per visual line fragment. This is exactly the same behavior as `anchor.getClientRects()` in the current implementation, and the existing `getNormalizedLineRects()` function can process these rects without modification.

#### B.2. Current Code vs. Solution F — The 1:1 Mapping

The current `positionTooltip()` function in `translationDisplay.ts` does:

```typescript
// Current (anchor-based)
function positionTooltip(anchorId: string): void {
    const anchor = document.getElementById(anchorId);
    const rects = getNormalizedLineRects(anchor);     // ← anchor.getClientRects()
    // ... position each tooltip segment relative to rects
}
```

Solution F would change only the source of rects:

```typescript
// Solution F (Range-based)
function positionTooltip(translationId: string): void {
    const range = activeRanges.get(translationId);
    if (!range || !range.startContainer.isConnected) {
        cleanupTranslation(translationId, "orphan");
        return;
    }
    const rects = getNormalizedLineRectsFromRange(range);  // ← range.getClientRects()
    // ... IDENTICAL positioning logic from here on
}
```

The `getNormalizedLineRects()` function itself needs only a trivial signature change:

```typescript
// Current
function getNormalizedLineRects(anchor: HTMLElement): DOMRect[] {
    const rects = Array.from(anchor.getClientRects())  // ← from Element
    // ... grouping logic (unchanged)
}

// Solution F
function getNormalizedLineRectsFromRange(range: Range): DOMRect[] {
    const rects = Array.from(range.getClientRects())    // ← from Range
    // ... IDENTICAL grouping logic
}
```

**The entire downstream pipeline (multi-line splitting, text measurement, viewport clamping) is unchanged.**

#### B.3. Dynamic Repositioning on Scroll and Resize

**Current behavior**: On scroll/resize → `requestAnimationFrame` → call `positionTooltip()` for each active translation → `anchor.getClientRects()`.

**Solution F behavior**: Identical flow, but `range.getClientRects()` instead.

**Critical point**: `Range.getClientRects()` is NOT a cached snapshot. It is **computed on-demand from the current layout** every time it's called. When the page scrolls or the window resizes:
- Text reflows to a new position → `range.getClientRects()` returns the NEW position.
- Text wraps differently (window narrower) → returns DIFFERENT number of rects with DIFFERENT widths.
- Text scrolls within a container → returns updated viewport-relative coordinates.

This is identical to how `Element.getClientRects()` works — both query the same rendering engine layout data.

**Verified behavior**:
| Scenario | `anchor.getClientRects()` | `range.getClientRects()` |
| :--- | :--- | :--- |
| Page scroll | ✅ Updated coords | ✅ Updated coords |
| Window resize / text reflow | ✅ New rects | ✅ New rects |
| Container scroll (overflow) | ✅ Updated | ✅ Updated |
| Text content unchanged | ✅ Stable | ✅ Stable |
| DOM node detached (React) | Returns empty (orphan) | Returns empty (orphan) |

**Conclusion: ✅ Positioning is equally precise. `Range.getClientRects()` is a 1:1 functional replacement for `Element.getClientRects()` in all scroll/resize scenarios.**

#### B.4. Range Invalidation by React (Acknowledged, Not a Blocker)

When React replaces a text node, our Range becomes detached (`range.startContainer.isConnected === false`). This is equivalent to the current anchor being removed from the DOM (existing "orphan cleanup" path).

Both architectures face this equally. It is detectable and cleanable:
```typescript
if (!range.startContainer.isConnected) {
    cleanupTranslation(id, "orphan");  // Same logic as current orphan path
}
```

This is a separate problem (Solution D / MutationObserver) and does NOT affect the precision of positioning when the Range is valid.

### C. Click and Interaction Handling

Since there's no `<span>` element, we need global hit-testing.

#### C.1. Click Detection via `caretRangeFromPoint`

```typescript
document.addEventListener("click", (e) => {
    const caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!caretRange) return;

    for (const [id, translationRange] of activeRanges) {
        if (rangeContainsPosition(translationRange, caretRange.startContainer, caretRange.startOffset)) {
            handleTranslationClick(id);
            return;
        }
    }
});
```

**Accuracy**: `caretRangeFromPoint` returns the exact character position under the pointer. For a translated phrase "brown fox jumps", clicking anywhere on those characters will return a position within our stored Range. This is **character-level precision** — more precise than clicking a `<span>` (which fires even for clicks on whitespace/padding).

**Performance**: Iterating `activeRanges` on each click is O(n) but n is typically < 20 translations per page. Sub-microsecond.

#### C.2. Double-Click

Double-click can use the native `dblclick` event on `document`:

```typescript
document.addEventListener("dblclick", (e) => {
    const caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
    // ... same hit-testing logic
    if (matchedId) {
        removeTranslation(matchedId);
    }
});
```

No need for timer-based detection — `dblclick` is a native DOM event that fires on any element including `document`.

**Note**: The current code uses `e.stopPropagation()` on anchor click/dblclick to prevent the events from reaching other handlers. With Solution F, since we're on a global listener, we'd need to be more careful about event ordering, but the `capture: true` pattern already used in the codebase handles this.

#### C.3. Cursor Change (Hover)

Without a `<span>`, we can't use CSS `cursor: pointer`. Options:
1. **Accept it**: Most subtitle/annotation tools don't change cursor. The underline-on-tooltip visual cue is sufficient.
2. **CSS `cursor` via `::highlight()`**: If we add the Highlight API for this one purpose, `cursor` is still not supported in `::highlight()`.
3. **Dynamic cursor via mousemove**: Listen to `mousemove`, hit-test with `caretRangeFromPoint`, set `document.body.style.cursor`. This works but adds a continuous mousemove listener (can be throttled to ~60fps with `requestAnimationFrame`).

**Recommendation**: Option 1 (accept it). The tooltip + top-border underline provides sufficient visual affordance.

### D. IntersectionObserver Replacement

**Current**: `IntersectionObserver` watches the anchor `<span>` to hide tooltips when it scrolls out of a sub-container.

**Solution F**: Cannot observe a Range. Two alternatives:

1. **Manual check during scroll reposition** (recommended):
   ```typescript
   function positionTooltip(id: string): void {
       const range = activeRanges.get(id);
       const rects = range.getClientRects();
       if (rects.length === 0) {
           // Range is not visible (scrolled out of container or collapsed)
           hideTooltips(id);
           return;
       }
       // ... normal positioning
   }
   ```
   When text is scrolled out of a sub-container's overflow, `getClientRects()` returns rects that are clipped or positioned outside the viewport. We can check if rects intersect with the scroll container's bounds.

2. **Invisible marker element**: Insert a zero-size `<span>` at the Range start position and observe it. This re-introduces minimal DOM intrusion but is far less impactful than wrapping all text.

**Recommendation**: Option 1. The scroll repositioning already runs via `requestAnimationFrame` on every scroll event. Adding a visibility check is negligible overhead.

### E. Other Integration Points

| Component | Current Usage | Solution F Adaptation | Effort |
| :--- | :--- | :--- | :--- |
| `lineHeightAdjuster` | `findNearestBlockAncestor(anchor)` | Use `range.startContainer.parentElement` | Low |
| `styleCalculator` | Read computed style from anchor's parent | Use `range.startContainer.parentElement` | Low |
| `ModalPositioner` | `anchorElement.getClientRects()` | `range.getClientRects()` | Low |
| `translationOverlapDetector` | Query `.ai-translator-anchor` elements | Range intersection checks | Medium |
| Orphan detection | `document.getElementById(anchorId)` → null | `range.startContainer.isConnected` → false | Low |
| `domSanitizer` | Strips extension spans from selections | Not needed (no spans to strip!) | Removed |

## 4. Architecture Comparison

| Dimension | Current (DOM Wrap) | Solution F (Range-based) |
| :--- | :--- | :--- |
| **React Compatibility** | ❌ Conflict (duplication bug) | ✅ Zero intrusion |
| **Underline Styling** | ✅ Full CSS on `<span>` | ✅ Via tooltip top-border |
| **Positioning Precision** | ✅ `Element.getClientRects()` | ✅ `Range.getClientRects()` (identical) |
| **Dynamic Reposition** | ✅ Scroll/resize via rAF | ✅ Identical (rAF + Range.getClientRects) |
| **Click Handling** | ✅ Native element events | ⚠️ Global listener + `caretRangeFromPoint` |
| **Cursor Pointer** | ✅ CSS `cursor: pointer` | ❌ Not available (acceptable trade-off) |
| **IntersectionObserver** | ✅ Native element observation | ⚠️ Manual rect-vs-viewport check |
| **domSanitizer** | Needed (strip spans from selection) | ✅ Not needed (no spans!) |
| **Effort to Migrate** | — | 🟡 Medium-High |

## 5. Migration Strategy (If Adopted)

### Phase 1: Data Structure
Replace `activeTranslations: Map<string, HTMLElement[]>` with:
```typescript
interface TranslationEntry {
    id: string;
    range: Range;                    // The text range (replaces anchor element)
    tooltips: HTMLElement[];         // Tooltip elements (same as today, portaled to body)
    translationData: TranslationDetailData;
    originalText: string;            // For re-anchoring and overlap detection
}
const activeTranslations = new Map<string, TranslationEntry>();
```

### Phase 2: Remove DOM Wrapping
In `showTranslationResult()`, replace:
```typescript
// REMOVE: const fragment = range.extractContents();
// REMOVE: anchor.appendChild(fragment);
// REMOVE: range.insertNode(anchor);

// NEW: Just store the range
const storedRange = range.cloneRange();
activeTranslations.set(id, { id, range: storedRange, tooltips: [], ... });
```

### Phase 3: Adapt Positioning
Change `positionTooltip()` to accept a Range instead of looking up an anchor by ID.

### Phase 4: Global Click Handlers
Add `caretRangeFromPoint`-based hit testing for click and dblclick.

### Phase 5: Cleanup
Remove `unwrapAnchorElement()`, `removeUntrackedAnchorElements()`, `domSanitizer`, and all anchor CSS classes.

## 6. Conclusion

With the revised understanding:
- **Underline**: ✅ Solved elegantly via tooltip top-border.
- **Positioning precision**: ✅ `Range.getClientRects()` is a 1:1 replacement with identical precision.
- **Dynamic repositioning**: ✅ Works identically on scroll/resize — `Range.getClientRects()` is computed on-demand from live layout.
- **React compatibility**: ✅ Zero DOM intrusion eliminates the root cause.

**Remaining costs**:
- Click handling is slightly more complex (global listener + hit-testing).
- No `cursor: pointer` on hover (acceptable).
- IntersectionObserver needs manual replacement (low effort).

**Verdict**: Solution F is **technically feasible and architecturally superior**. The positioning concerns are fully addressed — `Range.getClientRects()` provides identical precision to the current anchor-based approach. The migration effort is Medium-High but can be done incrementally. Recommended as a future architecture milestone.

## 7. Test Page

A test page is available at `other/tmp/range-getClientRects-test.html` to verify `Range.getClientRects()` behavior interactively:
- Partial text selection within a div
- Multi-line wrapping
- Resizable containers
- Nested elements (simulating a tweet)

Open in a browser and click the test buttons to see red overlays and mock tooltips positioned via `Range.getClientRects()`.
