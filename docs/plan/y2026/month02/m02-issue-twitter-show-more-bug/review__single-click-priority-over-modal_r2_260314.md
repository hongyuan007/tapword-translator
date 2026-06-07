# Code Review Report (Round 2): `single-click-priority-over-modal`

**Date**: 2026-03-14  
**TypeCheck**: ✅ PASS — zero errors.  
**Overall Verdict**: ❌ **REQUEST CHANGES** — 1 blocking issue remains.

---

## Fix Status from Round 1

| ID | Severity | Status | Notes |
|---|---|---|---|
| F-1 | 🔴 HIGH | ✅ **FIXED** | Circular dependency broken. `singleClickWordCandidate.ts` no longer imports `translationDisplayV2.ts`. `getActiveRanges` is now a function parameter. All three call sites pass the getter correctly. |
| F-2 | 🟡 MEDIUM | ⚠️ **NOT FIXED** | See N-1 below — the root cause was relocated, not eliminated. |
| F-3 | 🟡 MEDIUM | ✅ **FIXED** | Registration-order invariant comment added in `index.ts`. |
| F-4 | 🟡 MEDIUM | ⚠️ **PARTIAL** | hitTesting's redundant call removed (count: 3→2). The remaining 2 calls in `InputListener` and `selectionValidator` still perform `caretRangeFromPoint` separately. |
| F-5 | 🔵 LOW | ❌ **NOT FIXED** | `isFullyContainedBySingleActiveTranslation` not renamed. |
| F-6 | 🔵 LOW | ❌ **NOT FIXED** | No debug log when Guard A fires. |
| F-7 | 🔵 LOW | ❌ **NOT FIXED** | No stale-range guard before `triggerTranslationForRange`. |

---

## New Finding

---

### 🆕 N-1 (HIGH — BLOCKER): `suppressTranslationClickForEvent` called before async validation — same silent no-op as F-2

**File**: `src/1_content/handlers/InputListener.ts`

**Root cause**: The Guard B early-return was correctly removed from `hitTesting.handleClick`. However, `suppressTranslationClickForEvent(event.timeStamp)` was moved to the **pre-validation block** of `InputListener.handleSingleClick` — before `validateSingleClickAsync` is awaited. This produces the identical failure for native-language clicks inside a translated zone:

```
Click fires
  1. InputListener.handleSingleClick (capture, runs first)
       → word candidate found → suppressTranslationClickForEvent(event.timeStamp)  ← called TOO EARLY
  2. hitTesting.handleClick (capture, runs second)
       → sees suppressedClickTimeStamp === e.timeStamp → returns early
       → modal timer is NEVER started
  3. await validateSingleClickAsync(...)
  4a. isValid = true → cancelPendingTranslationClick() → new translation starts ✅
  4b. isValid = false (native-language suppression)
       → function returns early
       → no modal opened, no translation started → SILENT NO-OP ❌
```

The `suppressTranslationClickForEvent` stamp is designed for the **synchronous capture window** (to beat the second capture listener). Calling it before awaiting validation uses it as a long-lived flag, preventing any modal from opening even when the new translation falls back.

**Required Fix**: Delete the `suppressTranslationClickForEvent(event.timeStamp)` call from the pre-validation block entirely. `cancelPendingTranslationClick()` in the success branch is sufficient to cancel the modal after validation succeeds.

```typescript
// BEFORE (incorrect — suppresses before validation result is known):
const candidate = findSingleClickWordCandidateRangeFromPoint(...)
if (candidate) {
    suppressTranslationClickForEvent(event.timeStamp)   // ← DELETE THIS LINE
}
const validation = await validateSingleClickAsync(...)
if (!validation.isValid) return

cancelPendingTranslationClick()   // ← this is the correct and only cancellation point
await triggerTranslationForRange(...)

// AFTER (correct):
const validation = await validateSingleClickAsync(...)
if (!validation.isValid) return   // hitTesting's modal timer still running → modal opens as fallback

cancelPendingTranslationClick()   // ← cancels modal now that we know translation will proceed
await triggerTranslationForRange(...)
```

**Acceptance test** (manual):
1. Translate a word on an English page.
2. Click a different English word that overlaps the translation zone — new translation should start, modal should NOT open.
3. Switch to a page with a native-language word inside a translated zone — click it. The **modal** should open (validation fails, fallback fires correctly). Previously this was a silent no-op.

---

## Instructions for Fix Author

Only one change is required:

1. In `src/1_content/handlers/InputListener.ts`, **delete** the `suppressTranslationClickForEvent(event.timeStamp)` call from the pre-validation / pre-await block. Do not add it back anywhere else.
2. Confirm `cancelPendingTranslationClick()` is still present in the validation-success branch (it should be untouched).
3. Run `npm run type-check` and confirm zero errors.
4. No other files need to change for N-1.

The low-priority items (F-5 rename, F-6 debug log, F-7 stale-range guard) can be addressed in a follow-up pass if desired.
