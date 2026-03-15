# Code Review Report: `single-click-priority-over-modal`

**Date**: 2026-03-14  
**Reviewed Manifest**: `manifest__single-click-priority-over-modal_2026-03-14.md`  
**TypeCheck**: ✅ PASS — `npm run type-check` produced zero errors.  
**Overall Verdict**: ❌ **REQUEST CHANGES** — 2 blocking issues must be fixed before merge.

---

## Verified Objectives

| Objective | Status |
|---|---|
| Click on new underlying word → new translation wins over opening existing modal | ✅ Works |
| Click fully inside translated text (no new word candidate) → modal opens correctly | ✅ Works |
| Debounce modal timer cancelled before new translation request begins | ✅ Works |
| Suppression mechanism compiles and type-checks cleanly | ✅ Works |

---

## Findings

---

### 🔴 F-1 (HIGH — BLOCKER): Circular Module Dependency

**File**: `src/1_content/handlers/utils/singleClickWordCandidate.ts`

**Dependency cycle**:
```
translationDisplayV2.ts
  → (used by) hitTesting.ts
    → (imports) singleClickWordCandidate.ts
      → (imports) translationDisplayV2.ts   ← CIRCULAR
```

`singleClickWordCandidate.ts` lives in `handlers/utils/` (interaction logic layer) but directly imports `translationDisplayV2.ts` from `ui/`. This violates the module hierarchy in `src/1_content/README.md`: handler utilities must not depend on UI coordinators.

The runtime does not crash *today* because ES module live-bindings defer resolution to call time (`getActiveRanges()` is only called inside function bodies). However, this is architecturally fragile:
- Any future top-level initializer added to `singleClickWordCandidate.ts` that calls `getActiveRanges()` at module-eval time would silently read an empty map.
- Bundlers may reorder module evaluation during tree-shaking or chunk splitting.

**Required Fix**: Pass `getActiveRanges` as a callback parameter into `isFullyContainedBySingleActiveTranslation` instead of importing it directly.

```typescript
// singleClickWordCandidate.ts — remove import of translationDisplayV2
// Change signature to:
export function isFullyContainedBySingleActiveTranslation(
  candidateRange: Range,
  getActiveRanges: () => ReadonlyMap<string, { range: Range }>
): boolean { ... }

// Call sites pass the getter:
import * as translationDisplay from '@/1_content/ui/translationDisplayV2';

isFullyContainedBySingleActiveTranslation(
  candidateRange,
  translationDisplay.getActiveRanges
);
```

---

### 🟡 F-2 (MEDIUM — BLOCKER): Silent No-op When Native-Language Suppression Fires

**Files**: `src/1_content/handlers/InputListener.ts`, `src/1_content/ui/translationDisplayV2/hitTesting.ts`

**Scenario**:
1. `singleClickTranslate` is enabled.
2. User clicks a point inside an existing translation zone that also lies on a different, non-contained underlying word.
3. `hitTesting.handleClick` detects the word candidate → returns early → **no modal timer is started**.
4. `InputListener.handleSingleClick` validates the candidate word → native-language suppression fires → `isValid: false` is returned.
5. **Result: the click does nothing.** No new translation starts, and no modal opens. The user receives zero feedback.

The correct fallback: if single-click validation ultimately fails for a candidate found inside an existing translated zone, the modal for the existing translation should still open.

**Required Fix**: In `hitTesting.handleClick`, do **not** perform an unconditional early-return when a word candidate is found. Instead, set a flag and let the modal timer start as usual. The timer should be cancelled in `InputListener` only *after* async validation confirms the new translation will proceed.

Alternatively: move the word-candidate check **out of** `hitTesting.handleClick` entirely (remove it), and rely solely on `InputListener` calling `cancelPendingTranslationClick()` at the right moment. This avoids double-computation and is structurally cleaner.

---

### 🟡 F-3 (MEDIUM): Undocumented Capture-Phase Registration Order Invariant

**File**: `src/1_content/index.ts`

`suppressTranslationClickForEvent` works only because `InputListener.handleSingleClick` (capture) fires **before** `hitTesting.handleClick` (capture). This is true today because `ensureHitTestListeners()` is called lazily after `init()`. However, this invariant is implicit and undocumented.

Any future change that eagerly calls `ensureHitTestListeners()` during module initialization (before `init()`) would silently reverse the order and break the suppression mechanism with no compile-time error.

**Suggested Fix**: Add an explicit comment at the `attachGlobalHitListeners` call site:

```typescript
// REGISTRATION ORDER INVARIANT: hitTesting listeners must register AFTER
// InputListener.init() to ensure InputListener's capture handler fires first.
// The suppressTranslationClickForEvent mechanism depends on this ordering.
ensureHitTestListeners(...);
```

---

### 🟡 F-4 (MEDIUM): `findSingleClickWordCandidateRangeFromPoint` Called 3× per Click

**Files**: `src/1_content/handlers/InputListener.ts`, `src/1_content/ui/translationDisplayV2/hitTesting.ts`, `src/1_content/handlers/utils/selectionValidator.ts`

Each call invokes `caretRangeFromPoint` + `expandRangeToWord` + `getClientRects` hit-test + `compareBoundaryPoints` loop over all active ranges. With many active translations, this becomes non-trivial per interaction. All three calls happen in quick succession for the same event at the same `(clientX, clientY)`.

| Call # | Location | Purpose |
|---|---|---|
| 1 | `InputListener.ts` (~line 57) | Before async validation |
| 2 | `hitTesting.ts` (~line 121) | Inside `handleClick` guard |
| 3 | `selectionValidator.ts` (~line 213) | `validateSingleClickAsync` step 5 |

**Suggested Fix**: Cache the resolved candidate range on a per-event basis (keyed by `event.timeStamp`), or pass the already-resolved range from `InputListener` through the validation arguments, eliminating redundant computation.

---

### 🔵 F-5 (LOW): Misleading Function Name

**File**: `src/1_content/handlers/utils/singleClickWordCandidate.ts`

`isFullyContainedBySingleActiveTranslation` — the word "Single" implies it checks against only one translation. The actual behavior is: "returns true if the candidate range is fully contained by **any one of** the active translations."

**Suggested Fix**: Rename to `isContainedByAnyActiveTranslation`.

---

### 🔵 F-6 (LOW): Guard A Is Redundant and Leaves No Debug Trace

**File**: `src/1_content/ui/translationDisplayV2/hitTesting.ts` (~lines 99–126)

`hitTesting.handleClick` has two sequential guards for the same scenario:
- **Guard A**: `if (suppressedClickTimeStamp === e.timeStamp) { return }` — checks suppression stamp set by InputListener.
- **Guard B**: `if (isSingleClickTranslateEnabled() && findSingleClickWordCandidateRangeFromPoint(...)) { return }` — independently re-checks word candidate.

Guard B alone is sufficient for preventing the modal. Guard A only protects an ordering-dependent edge case, and when it fires it leaves no trace — zero logging — making it invisible during debugging.

**Suggested Fix**: Add a debug log when Guard A fires:
```typescript
logger.debug('Modal suppressed by InputListener event stamp');
```

---

### 🔵 F-7 (LOW): No Stale-Range Guard Before `triggerTranslationForRange` on SPA Navigation

**File**: `src/1_content/handlers/InputListener.ts`

If `SpaNavigationHandler` calls `removeAllTranslationResults()` concurrently while an async validation is mid-flight, the `validation.range!` passed to `triggerTranslationForRange` points to a detached DOM range. This is pre-existing behavior (not introduced by this PR), but the new code path widens the window during which stale ranges can propagate.

**Suggested Fix**: Defensive check before triggering:
```typescript
if (!validation.range!.startContainer.isConnected) {
  logger.debug('Word range detached before translation could start; aborting');
  return;
}
triggerTranslationForRange(validation.range!, ...);
```

---

## Fix Priority Summary

| ID | Severity | Must Fix | Description |
|---|---|---|---|
| F-1 | 🔴 HIGH | **YES** | Circular dependency via `singleClickWordCandidate.ts` → `translationDisplayV2.ts` |
| F-2 | 🟡 MEDIUM | **YES** | Silent no-op when native-language suppression fires inside translated zone |
| F-3 | 🟡 MEDIUM | Recommended | Document capture-phase registration order invariant |
| F-4 | 🟡 MEDIUM | Recommended | Eliminate 3× redundant `caretRangeFromPoint` calls per click |
| F-5 | 🔵 LOW | Optional | Rename `isFullyContainedBySingleActiveTranslation` |
| F-6 | 🔵 LOW | Optional | Add debug log to Guard A in hitTesting |
| F-7 | 🔵 LOW | Optional | Add stale-range guard before `triggerTranslationForRange` |

---

## Instructions for Fix Author

1. Fix **F-1** by removing the direct import of `translationDisplayV2` from `singleClickWordCandidate.ts`. Pass `getActiveRanges` as a function parameter at each call site.
2. Fix **F-2** by removing the early-return word-candidate guard from `hitTesting.handleClick` entirely, and relying solely on `cancelPendingTranslationClick()` in `InputListener` to suppress the modal after validation succeeds.
3. After changes, run `npm run type-check` and confirm zero errors.
4. No automated tests required — user will verify manually.
