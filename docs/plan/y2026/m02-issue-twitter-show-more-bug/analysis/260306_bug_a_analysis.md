# Bug A: Click-on-Translated-Text Still Triggers New Translation — Root Cause Analysis

> Created: 2026-03-06

## 1. Bug Summary

In the V2 Range-based translation system, clicking on already-translated text creates a **new** translation tooltip (translation-1) on top of the existing one (translation-0), instead of opening the detail modal.

**Expected**: Single-click on translated text → opens detail modal (V1 parity).
**Actual**: Single-click on translated text → creates duplicate translation.

---

## 2. Root Cause

The bug is caused by **two compounding issues**:

### Issue A (Primary): `isPointInsideActiveTranslation()` returns `false` when it should return `true`

The guard in `selectionValidator.validateSingleClickAsync()` calls `translationDisplay.isPointInsideActiveTranslation(event.clientX, event.clientY)` to block re-translation. This function uses `document.caretRangeFromPoint(x, y)` to convert screen coordinates to a DOM caret position, then checks that position against stored translation Ranges via `rangeContainsPosition()`.

**This approach is unreliable.** The `caretRangeFromPoint` API has known precision issues:

1. **Tooltip text node interference**: The tooltip element (`.ai-translator-tooltip`) has `z-index: 999998` and `pointer-events: none`. While `pointer-events: none` prevents mouse events from reaching the tooltip, `document.caretRangeFromPoint()` is NOT a mouse event — it's a layout-based API. Chromium's implementation performs hit testing internally, and **some implementations do not fully respect `pointer-events: none`** when resolving caret positions. If `caretRangeFromPoint` resolves into the tooltip's text node (containing "回归") instead of the page's text node (containing "return"), then `rangeContainsPosition()` will fail — the tooltip text node is outside the stored translation Range.

2. **Silent exception in `rangeContainsPosition()`**: The function wraps `Range.compareBoundaryPoints()` in a bare `try-catch` that returns `false` on ANY exception:
   ```typescript
   // src/1_content/ui/translationDisplayV2/hitTesting.ts (rangeContainsPosition)
   try {
       const point = document.createRange()
       point.setStart(node, offset)
       point.collapse(true)
       return (
           range.compareBoundaryPoints(Range.START_TO_START, point) <= 0 &&
           range.compareBoundaryPoints(Range.END_TO_START, point) >= 0
       )
   } catch {
       return false  // ← Silent failure — any error returns false
   }
   ```
   If `compareBoundaryPoints` throws (e.g., WrongDocumentError when comparing ranges across different root containers, or if either Range references a detached node), the catch block silently returns `false`, making the function report "not inside translation" when it should report an error.

3. **Sub-pixel / boundary precision**: `caretRangeFromPoint` can return caret positions at text node boundaries that don't cleanly fall within the stored Range. After line-height adjustment (26px → 38px, as shown in the log), text reflows occur. The stored Range's DOM boundaries are unchanged, but `caretRangeFromPoint` may resolve to a slightly different offset depending on the browser's layout engine state.

**Evidence from the log** (see `问题a日志.txt`):
- After translation-0 is created, the second click produces `[selectionHandler] [Single Click] Translation requested for: return` — meaning `validateSingleClickAsync` returned `isValid: true`.
- If `isPointInsideActiveTranslation` had returned `true`, the log would show `[Single Click] Skipped: Click inside active translation` (at debug level). This line is absent.
- No log output from hitTesting matching either — `findHitTranslation` uses the same `caretRangeFromPoint` + `rangeContainsPosition` mechanism and also fails to find the translation.

### Issue B (Architectural): Event Handler Registration Order Prevents Coordination

Both `handleSingleClick` and `hitTesting.handleClick` are registered on `document` in the **capture** phase. They fire in **registration order** — and `handleSingleClick` is always first:

| Handler | Registration Time | Phase | Source |
|---|---|---|---|
| `inputListener.handleSingleClick` | Content script init (`index.ts`) | Capture | `document.addEventListener("click", ..., { capture: true })` |
| `hitTesting.handleClick` | First translation shown (`ensureHitTestListeners`) | Capture | `document.addEventListener("click", ..., { capture: true })` |

Since both are on the same target (`document`) and same phase (`capture`), `stopPropagation()` called by hitTesting does NOT prevent `handleSingleClick` from executing — it only prevents propagation to child elements. `stopImmediatePropagation()` would prevent subsequent same-target listeners, but `handleSingleClick` has already started (it fires first) and cannot be stopped retroactively.

**Consequence**: The **only** mechanism to prevent re-translation is `isPointInsideActiveTranslation()` inside `selectionValidator`. HitTesting cannot serve as a backup guard. When `isPointInsideActiveTranslation()` fails, nothing prevents the duplicate translation.

---

## 3. Event Flow Diagram

### Normal Flow (Expected — `isPointInsideActiveTranslation` returns `true`)

```
User clicks on translated text "return"
│
├─ [mousedown] → handleDocumentClick() → removeTranslationIcon()
├─ [mouseup]   → handleTextSelection() → "Empty selection" (collapsed selection on click)
│
└─ [click, capture phase on document]
    │
    ├─ ① handleSingleClick fires FIRST (registered at init)
    │   │
    │   └─ await validateSingleClickAsync(event, settings)
    │       │
    │       ├─ Step 0-2: Settings & event checks → PASS
    │       ├─ Step 3:   Extension UI closest → PASS (target is page text, not tooltip)
    │       ├─ V2 Check: isPointInsideActiveTranslation(clientX, clientY)
    │       │             └─ caretRangeFromPoint → rangeContainsPosition → TRUE ✓
    │       │
    │       └─ Returns { isValid: false, reason: "Click inside active translation" }
    │
    │   handleSingleClick returns early. No new translation.
    │
    ├─ ② hitTesting.handleClick fires SECOND (registered at first translation)
    │   │
    │   ├─ caretRangeFromPoint → findHitTranslation → matchedId found
    │   ├─ Grace period check → PASS (well past 400ms)
    │   ├─ e.stopPropagation()
    │   └─ setTimeout(250ms) → onTranslationClick(id) → Opens detail modal ✓
    │
    └─ [Event dispatch complete]
```

### Buggy Flow (Actual — `isPointInsideActiveTranslation` returns `false`)

```
User clicks on translated text "return"
│
├─ [mousedown] → handleDocumentClick() → removeTranslationIcon()
├─ [mouseup]   → handleTextSelection() → "Empty selection"
│
└─ [click, capture phase on document]
    │
    ├─ ① handleSingleClick fires FIRST
    │   │
    │   └─ await validateSingleClickAsync(event, settings)
    │       │
    │       ├─ Step 0-2: Settings & event checks → PASS
    │       ├─ Step 3:   Extension UI closest → PASS
    │       ├─ V2 Check: isPointInsideActiveTranslation(clientX, clientY)
    │       │             └─ caretRangeFromPoint → rangeContainsPosition → FALSE ✗
    │       │                 (tooltip text node? silent exception? offset mismatch?)
    │       │
    │       ├─ Step 4:   Selection check → PASS (collapsed)
    │       ├─ Step 5:   tapWordDetector.getWordRangeFromPoint → Range for "return"
    │       ├─ Step 6-7: Text validation → PASS
    │       ├─ Step 8:   await isNativeLanguageAsync(...) ← YIELDS to microtask queue
    │       │
    │       │   [Browser continues to next capture handler]
    │       │
    ├─ ② hitTesting.handleClick fires SECOND
    │   │   (ALSO uses caretRangeFromPoint + rangeContainsPosition → ALSO fails)
    │   │   OR: finds match, calls stopPropagation — BUT handleSingleClick already started
    │   │
    │   └─ Cannot prevent handleSingleClick from completing
    │
    │   [Microtask queue resumes]
    │
    │   Step 8 resolves → isNative = false → { isValid: true }
    │
    │   handleSingleClick proceeds:
    │   └─ triggerTranslationForRange → processTranslation → translateWordPath
    │       └─ showTranslationResult → translation-1 CREATED ✗ (duplicate!)
    │
    └─ [Two tooltips now stacked for same word]
```

---

## 4. Code References

### `isPointInsideActiveTranslation` — the failing guard
**File**: `src/1_content/ui/translationDisplayV2.ts` (line 463)
```typescript
export function isPointInsideActiveTranslation(x: number, y: number): boolean {
    if (activeTranslations.size === 0) return false

    const caretRange = document.caretRangeFromPoint(x, y)
    if (!caretRange) return false

    for (const [, entry] of activeTranslations) {
        if (hitTesting.rangeContainsPosition(entry.range, caretRange.startContainer, caretRange.startOffset)) {
            return true
        }
    }
    return false
}
```

### Caller in selectionValidator
**File**: `src/1_content/handlers/utils/selectionValidator.ts` (line 212)
```typescript
// V2: Check if click point falls inside an active translation Range
if (translationDisplay.isPointInsideActiveTranslation(event.clientX, event.clientY)) {
    return { isValid: false, text: "", reason: "Click inside active translation", shouldCleanup: false }
}
```

### `rangeContainsPosition` — silent failure on exception
**File**: `src/1_content/ui/translationDisplayV2/hitTesting.ts` (line 155)
```typescript
export function rangeContainsPosition(range: Range, node: Node, offset: number): boolean {
    try {
        const point = document.createRange()
        point.setStart(node, offset)
        point.collapse(true)
        return (
            range.compareBoundaryPoints(Range.START_TO_START, point) <= 0 &&
            range.compareBoundaryPoints(Range.END_TO_START, point) >= 0
        )
    } catch {
        return false  // Silent failure
    }
}
```

### Event registration order
**File**: `src/1_content/index.ts` (line 87)
```typescript
// Registered FIRST — always fires before hitTesting
document.addEventListener("click", inputListener.handleSingleClick, { capture: true })
```

**File**: `src/1_content/ui/translationDisplayV2/hitTesting.ts` (line 56)
```typescript
// Registered LATER — fires after handleSingleClick
document.addEventListener("click", handleClick, CAPTURE_OPTIONS)
```

### Tooltip CSS — `pointer-events: none` and high z-index
**File**: `src/1_content/resources/content.css` (line 76)
```css
.ai-translator-tooltip {
    position: absolute;
    z-index: 999998;
    pointer-events: none;  /* Clicks pass through, but caretRangeFromPoint may not */
    /* ... */
}
```

---

## 5. Proposed Fix (Primary): Rect-Based Hit Testing

Replace the unreliable `caretRangeFromPoint` + `rangeContainsPosition` approach with **visual bounding rect comparison** using `Range.getClientRects()`.

### 5.1 Fix `isPointInsideActiveTranslation()`

**File**: `src/1_content/ui/translationDisplayV2.ts`

```typescript
// BEFORE (unreliable):
export function isPointInsideActiveTranslation(x: number, y: number): boolean {
    if (activeTranslations.size === 0) return false
    const caretRange = document.caretRangeFromPoint(x, y)
    if (!caretRange) return false
    for (const [, entry] of activeTranslations) {
        if (hitTesting.rangeContainsPosition(entry.range, caretRange.startContainer, caretRange.startOffset)) {
            return true
        }
    }
    return false
}

// AFTER (robust):
export function isPointInsideActiveTranslation(x: number, y: number): boolean {
    if (activeTranslations.size === 0) return false
    for (const [, entry] of activeTranslations) {
        if (isPointInsideRange(x, y, entry.range)) {
            return true
        }
    }
    return false
}

/**
 * Check if a screen point (clientX, clientY) falls within any of a Range's
 * visual bounding rects. Operates in pixel space — no caretRangeFromPoint needed.
 */
function isPointInsideRange(x: number, y: number, range: Range): boolean {
    const rects = range.getClientRects()
    for (const rect of Array.from(rects)) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return true
        }
    }
    return false
}
```

### 5.2 Fix `hitTesting.findHitTranslation()`

**File**: `src/1_content/ui/translationDisplayV2/hitTesting.ts`

```typescript
// BEFORE:
function findHitTranslation(node: Node, offset: number): string | null {
    if (!callbacks) return null
    for (const [id, entry] of callbacks.getActiveTranslations()) {
        if (rangeContainsPosition(entry.range, node, offset)) return id
    }
    return null
}

// AFTER (rect-based):
function findHitTranslationByPoint(x: number, y: number): string | null {
    if (!callbacks) return null
    for (const [id, entry] of callbacks.getActiveTranslations()) {
        if (isPointInsideRange(x, y, entry.range)) return id
    }
    return null
}

function isPointInsideRange(x: number, y: number, range: Range): boolean {
    const rects = range.getClientRects()
    for (const rect of Array.from(rects)) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return true
        }
    }
    return false
}
```

Update callers in `handleClick` and `handleDblClick`:
```typescript
function handleClick(e: MouseEvent): void {
    if (!callbacks) return
    const target = e.target as Element
    if (target.closest(OWN_UI_SELECTOR)) return

    // CHANGED: Use rect-based hit test instead of caretRangeFromPoint
    const matchedId = findHitTranslationByPoint(e.clientX, e.clientY)
    if (!matchedId) return

    // ... rest unchanged
}
```

### 5.3 Why This Works

| Aspect | `caretRangeFromPoint` approach | `getClientRects` approach |
|---|---|---|
| Coordinates → DOM node | Required (fragile) | Not needed |
| DOM tree comparison | `compareBoundaryPoints` (can throw) | Not needed |
| Tooltip interference | Possible (z-index, `pointer-events`) | Impossible (compares against Range rects only) |
| Browser quirks | Known precision issues | `getClientRects` is well-tested and stable |
| Implementation complexity | Higher | Lower |
| Performance | ~Same (both iterate active translations) | ~Same |

Both `Range.getClientRects()` and `caretRangeFromPoint` force synchronous layout. Performance is equivalent.

### 5.4 Files to Modify

| File | Change |
|---|---|
| `src/1_content/ui/translationDisplayV2.ts` | Replace `isPointInsideActiveTranslation` body with rect-based check |
| `src/1_content/ui/translationDisplayV2/hitTesting.ts` | Add `findHitTranslationByPoint`, update `handleClick`/`handleDblClick` to use it |

The `HitTestCallbacks` interface needs a minor update — `getActiveTranslations()` should include the `range` property (already included).

---

## 6. Alternative Approaches

### Alternative A: Add Shared Coordination Flag

Instead of fixing the hit-testing mechanism, add a module-level flag that hitTesting sets when it handles a click:

```typescript
// In hitTesting.ts:
let lastClickHandledTimestamp = 0
export function wasRecentlyHandled(): boolean {
    return Date.now() - lastClickHandledTimestamp < 50
}

// In handleClick:
if (matchedId) {
    lastClickHandledTimestamp = Date.now()
    // ...
}
```

```typescript
// In selectionValidator.ts:
if (hitTesting.wasRecentlyHandled()) {
    return { isValid: false, reason: "Click handled by hitTesting" }
}
```

**Pros**: Simple, doesn't change hit-testing logic.
**Cons**: Doesn't fix the underlying `caretRangeFromPoint` issue. Also doesn't work because `handleSingleClick` fires BEFORE `hitTesting.handleClick` (registration order). The flag would not be set yet when `selectionValidator` checks it. **REJECTED — timing problem.**

### Alternative B: Move hitTesting Registration Before handleSingleClick

Register hitTesting listeners at init time (before `handleSingleClick`), even if no translations exist yet:

```typescript
// In index.ts init():
hitTesting.attachGlobalHitListeners(callbacks)  // Register FIRST
document.addEventListener("click", inputListener.handleSingleClick, { capture: true })  // Register SECOND
```

Then in `handleClick`, if a translation is found, call `e.stopImmediatePropagation()` instead of `e.stopPropagation()` to prevent `handleSingleClick` from firing.

**Pros**: Clean event handling — hitTesting intercepts first.
**Cons**: 
- Requires hitTesting to be initialized before any translations exist (needs null-safe callbacks).
- `stopImmediatePropagation` is a strong tool that might break other page behaviors.
- Still relies on `caretRangeFromPoint` correctness.
- Doesn't fix `isPointInsideActiveTranslation` for `validateSelectionAsync` (used by double-click and icon paths).

### Alternative C: Hybrid — Rect-Based `isPointInsideActiveTranslation` + caretRange-Based `hitTesting`

Apply the rect-based fix ONLY to `isPointInsideActiveTranslation` (the guard). Keep `hitTesting.findHitTranslation` using `caretRangeFromPoint` (since it needs precise Range-level matching for modal positioning).

**Pros**: Minimal change, fixes the primary bug.
**Cons**: hitTesting modal-open still uses the potentially broken mechanism. But since translation display still works correctly even without the modal, and the duplicate translation is the more critical bug, this is acceptable as a first step.

### Recommended Strategy

**Phase 1**: Apply the rect-based fix to `isPointInsideActiveTranslation()` only (Alternative C). This directly fixes Bug A with minimal risk.

**Phase 2**: Update `hitTesting.findHitTranslation()` to use rect-based matching as well, ensuring robust modal-open behavior.

---

## 7. Verification Plan

After applying the fix:

1. **Reproduce original bug**: Single-click translate "return", then click on it again. Verify NO translation-1 is created.
2. **Verify modal opens**: After translation-0 is shown, single-click on "return" → detail modal should open.
3. **Verify double-click removes**: After translation-0 is shown, double-click on "return" → translation-0 should be removed.
4. **Edge cases**:
   - Click at word boundary (start/end of "return")
   - Click after line-height adjustment
   - Click on multi-line fragment translations
   - Click on different words (should still trigger new translations)
5. **Regression**: Verify normal translation flow (single-click, double-click, icon click) still works on fresh text.
