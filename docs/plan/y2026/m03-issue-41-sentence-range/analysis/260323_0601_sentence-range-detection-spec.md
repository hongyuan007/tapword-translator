# Spec: Sentence Range Detection Bug Fix (Issue #41)

**Date**: 2026-03-23  
**Author**: Lao Xue (Research Agent)  
**Status**: Draft — awaiting review

---

## 1. Problem Statement

When double-clicking to translate a sentence (modifier key mode), commas **within numbers** (e.g., `10,000`, `1,500,000`) are incorrectly treated as sentence delimiters by the soft terminator logic. This causes the detected sentence range to be truncated at the numeric comma, breaking translation context.

### Example

> "The company reported revenue of **10,000** dollars and plans to hire more staff next year."

Double-clicking on "reported" → `expandRangeToSentence` stops at the comma in `10,000`, producing:

- **Expected**: `The company reported revenue of 10,000 dollars and plans to hire more staff next year.`
- **Actual**: `The company reported revenue of 10`

---

## 2. Current State Analysis

### 2.1 Architecture Overview

The sentence expansion flow:

```
User double-click (with modifier)
  → InputListener.handleDoubleClick()
    → expandRangeToSentence(range)          [contextExtractorV2.ts]
      → Greedy-Short strategy using hard + soft terminators
```

`expandRangeToSentence` is **only** called during double-click-with-modifier sentence mode. Regular word/fragment translations use `extractContextV2` for context (which only uses hard terminators: `.`, `?`, `!`).

### 2.2 Key Files

| File | Role |
|---|---|
| `src/1_content/utils/contextExtractorV2.ts` | Core file containing `expandRangeToSentence()`, `extractContextV2()`, and helper functions |
| `src/1_content/handlers/InputListener.ts` | Calls `expandRangeToSentence()` on double-click with modifier (line 119) |
| `src/1_content/handlers/TranslationPipeline.ts` | Receives the expanded range, splits by blocks, routes translation |
| `tests/1_content/utils/contextExtractorV2.test.ts` | Existing unit tests (do NOT cover `expandRangeToSentence` — only `extractContextV2`) |

### 2.3 The Greedy-Short Algorithm (`expandRangeToSentence`)

**Step 1 — Hard limits**: Find absolute sentence boundaries using `DEFAULT_HARD_TERMINATORS`: `[., ?, !, 。, ？, ！, …, \n]`

**Step 2 — Soft boundaries**: Find the tightest boundaries using `allTerminators` (hard + soft). `DEFAULT_SOFT_TERMINATORS`: `[, ， ; ； : ： —]`

**Step 3 — Right expansion (priority)**: If the soft segment is too short (`< 3 words` or `< 5 CJK chars`), expand rightward by finding the next soft terminator boundary.

**Step 4 — Left expansion (fallback)**: If still too short, expand leftward.

### 2.4 Terminator Matching Functions

```typescript
function firstTerminatorIndex(s: string, terminators: Set<string>): number {
    let best = Number.POSITIVE_INFINITY
    for (const ch of terminators) {
        const i = s.indexOf(ch)
        if (i !== -1 && i < best) best = i
    }
    return best === Number.POSITIVE_INFINITY ? -1 : best
}

function lastTerminatorIndex(s: string, terminators: Set<string>): number {
    let best = -1
    for (const ch of terminators) {
        const i = s.lastIndexOf(ch)
        if (i > best) best = i
    }
    return best
}
```

These are **pure character-level scans** — they have zero awareness of the surrounding character context. Any comma `,` matches regardless of whether it's a sentence-level separator or part of a number.

---

## 3. Root Cause Analysis

The bug has **two layers**:

### 3.1 Primary Cause: Soft terminators treat ALL commas equally

`firstTerminatorIndex` and `lastTerminatorIndex` scan for `,` as a single character. When text contains `10,000`, the comma after `10` is treated as a soft sentence boundary — identical to a grammatical comma between clauses.

**Why soft terminators?** The "Greedy-Short" strategy intentionally uses soft terminators (comma, semicolon, colon) to produce shorter sentence fragments when the full hard-bounded sentence is very long. This is a design tradeoff: shorter context = faster/cheaper API calls, but it blindly splits on any comma.

### 3.2 Secondary Concern: No numeric-aware lookahead/lookbehind

Even for hard terminators (period), a period after an abbreviation like `"Dr."` or `"U.S."` could cause false splits. The current code has no abbreviation or numeric pattern awareness. However, this is **not** the reported bug and is out of scope for this fix.

---

## 4. Proposed Changes

### 4.1 Strategy: Context-aware soft terminator matching

Replace the naive character scan in `firstTerminatorIndex` and `lastTerminatorIndex` with a **context-aware** version that skips commas inside numbers.

#### 4.1.1 New helper: `isCommaInsideNumber(text, index)`

```typescript
/**
 * Check if a comma at `index` in `text` is part of a number pattern.
 * Matches patterns like: 10,000 | 1,500,000 | ,000 (leading)
 * Does NOT match: clause, followed by space
 */
function isCommaInsideNumber(text: string, index: number): boolean {
    // Must be a comma character
    if (text[index] !== ',' && text[index] !== '，') return false

    // Number pattern: digit(s) on both sides of comma
    // Also handles partial patterns at text boundaries
    const before = text[index - 1]
    const after = text[index + 1]

    const beforeIsDigit = before !== undefined && /\d/.test(before)
    const afterIsDigit = after !== undefined && /\d/.test(after)

    // Core pattern: d,ddd
    if (beforeIsDigit && afterIsDigit) return true

    // Partial patterns at boundaries (rare but safe):
    // ,ddd at text start
    if (afterIsDigit) {
        // Check if followed by more digit groups: ,000,000
        const afterText = text.substring(index + 1)
        if (/^\d{3}(,\d{3})*(\D|$)/.test(afterText)) return true
    }

    return false
}
```

#### 4.1.2 Modified: `firstTerminatorIndex` and `lastTerminatorIndex`

Add a parameter to optionally skip numeric commas:

```typescript
function firstTerminatorIndex(s: string, terminators: Set<string>, skipNumericCommas: boolean = false): number {
    // ... iterate over string character by character
    // For each terminator match, check if it's a numeric comma and skip if needed
}
```

**Alternative approach (simpler, preferred)**: Instead of modifying the index functions, add a **pre-processing step** in `expandRangeToSentence` that temporarily replaces numeric commas with a placeholder before terminator scanning, then restores them.

#### 4.1.3 Recommended: Placeholder approach

In `expandRangeToSentence`, before running the Greedy-Short algorithm:

```typescript
// Pre-process: replace numeric commas with placeholder to prevent false splits
const NUMERIC_COMMA_PLACEHOLDER = '\x00'  // null character (won't appear in DOM text)

function protectNumericCommas(text: string): string {
    return text.replace(/(\d),(\d{3})/g, `$1${NUMERIC_COMMA_PLACEHOLDER}$2`)
}

function restoreNumericCommas(text: string): string {
    return text.replace(new RegExp(NUMERIC_COMMA_PLACEHOLDER, 'g'), ',')
}
```

**Note**: This placeholder approach is simpler but doesn't work directly because `expandRangeToSentence` operates on **DOM nodes**, not a single string. The terminator functions scan individual text nodes character by character.

### 4.2 Final Recommended Approach: Context-aware scan

Modify `firstTerminatorIndex` and `lastTerminatorIndex` to accept a `skipNumericCommas` flag. When enabled, skip comma matches where adjacent characters are digits.

**Files to modify:**

| File | Change |
|---|---|
| `src/1_content/utils/contextExtractorV2.ts` | 1. Add `isCommaInsideNumber()` helper. 2. Modify `firstTerminatorIndex()` and `lastTerminatorIndex()` to skip numeric commas. 3. In `expandRangeToSentence`, pass `skipNumericCommas: true` when calling soft terminator search. |
| `tests/1_content/utils/contextExtractorV2.test.ts` | Add test cases for `expandRangeToSentence` (currently untested) including: numeric comma scenarios, edge cases with decimal numbers (`3.14`), mixed CJK+numeric text. |

### 4.3 Scope Boundaries

**In scope:**
- Commas inside numbers (`,`) — primary fix
- Chinese commas (`，`) inside numbers — if such patterns exist
- Period in decimal numbers (`3.14`) — should NOT be treated as hard terminator

**Out of scope:**
- Abbreviation detection (`Dr.`, `U.S.`, `etc.`) — separate issue
- Smart quotes or other Unicode variants
- Commas in non-numeric structured data (dates like `2026-03-23` don't use commas)

---

## 5. Detailed Implementation Notes

### 5.1 Changes to `firstTerminatorIndex`

```typescript
function firstTerminatorIndex(s: string, terminators: Set<string>, skipNumericCommas: boolean = false): number {
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (!terminators.has(ch)) continue
        if (skipNumericCommas && isCommaInsideNumber(s, i)) continue
        return i
    }
    return -1
}
```

### 5.2 Changes to `lastTerminatorIndex`

```typescript
function lastTerminatorIndex(s: string, terminators: Set<string>, skipNumericCommas: boolean = false): number {
    let best = -1
    for (const ch of terminators) {
        let idx = s.length - 1
        // Scan backwards from end, skipping numeric commas
        while (idx >= 0) {
            const found = s.lastIndexOf(ch, idx)
            if (found === -1) break
            if (skipNumericCommas && isCommaInsideNumber(s, found)) {
                idx = found - 1
                continue
            }
            if (found > best) best = found
            break
        }
    }
    return best
}
```

### 5.3 Changes to `expandRangeToSentence` call sites

In the soft boundary search (Steps 2-4), use `skipNumericCommas: true`:
- `findSentenceEndWithin` with `allTerminators` → add flag
- `findSentenceStartWithin` with `allTerminators` → add flag
- Hard terminator searches remain unchanged (periods in `3.14` also need handling — see 5.4)

### 5.4 Decimal number protection (bonus)

Period (`.`) in `3.14` or `0.5` could also be falsely matched as a hard terminator. Add similar protection:

```typescript
function isPeriodInsideNumber(text: string, index: number): boolean {
    if (text[index] !== '.') return false
    const before = text[index - 1]
    const after = text[index + 1]
    return /\d/.test(before || '') && /\d/.test(after || '')
}
```

Apply in `findSentenceEndWithin` and `findSentenceStartWithin` when scanning with hard terminators.

---

## 6. Verification Plan

### 6.1 Unit Tests (Vitest)

Add to `tests/1_content/utils/contextExtractorV2.test.ts`:

**New describe block: `expandRangeToSentence`**

| Test Case | Input Selection | Expected Sentence |
|---|---|---|
| Comma in large number | `reported` in `"reported revenue of 10,000 dollars."` | Full sentence including `10,000` |
| Comma in multi-group number | `budget` in `"budget of 1,500,000 dollars."` | Full sentence |
| Multiple numeric commas | `cost` in `"cost is 1,000 and tax is 500."` | Full sentence |
| Real sentence comma | `quickly` in `"ran quickly, then stopped."` | `"ran quickly, then stopped."` (comma still works as soft boundary) |
| Decimal number period | `value` in `"value of 3.14 is precise."` | Full sentence (period in `3.14` not treated as terminator) |
| CJK with numbers | `增长` in `"增长10,000人，计划..."` | Full sentence |
| Mixed: numeric + real commas | `sold` in `"sold 1,000 units, making profit."` | Real comma splits; numeric comma preserved |

### 6.2 Edge Cases

- Empty range → no crash, return cloned range
- Selection at text node boundary with numeric comma → no crash
- Very large number: `1,000,000,000` → all commas protected
- Number at sentence start: `"10,000 people attended."` → no false split

### 6.3 Manual Testing (Playwright E2E)

Create a test page with sentences containing numbers with commas. Double-click with modifier key. Verify:
1. The underlined range covers the full expected sentence
2. Translation API receives the correct text (with numeric commas intact)

### 6.4 Regression

- Run existing `contextExtractorV2.test.ts` suite — all current tests must pass
- Verify `extractContextV2` (hard terminators only) is NOT affected by the change
- Verify regular word/fragment double-click (without modifier) is unaffected

---

## 7. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `isCommaInsideNumber` false positive (e.g., `role,play`) | Low | Only matches when both sides are digits |
| Performance impact from per-character scanning | Negligible | Scanning already happens per-char; added check is O(1) |
| Breaking existing translations | Low | Only affects `expandRangeToSentence`, which is sentence-mode only |
| Decimal period protection introduces new bugs | Medium | Decimal protection is optional/bonus; can be deferred to separate issue |

---

## 8. Open Questions

1. Should `expandRangeToSentence` export be tested directly? Currently it requires DOM setup (Range, TreeWalker). The existing test file already sets this up.
2. Should decimal number protection be included in this PR or deferred? Recommendation: include it — it's the same pattern and prevents a very likely related bug.
3. Is the placeholder approach (pre-process string) worth exploring as an alternative? It's conceptually simpler but doesn't fit the DOM-node-based architecture well.

---

## Appendix A: Relevant Code Snippets

### A.1 `expandRangeToSentence` call in InputListener.ts (line 119)
```typescript
if (isSentenceMode) {
    logger.info(`Modifier key (${triggerKey}) pressed, expanding selection to full sentence.`)
    range = expandRangeToSentence(range)
}
```

### A.2 `isSegmentShort` — determines when to expand
```typescript
function isSegmentShort(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return true
    const hasCJK = CJK_PATTERN.test(trimmed)
    if (hasCJK) {
        return trimmed.length < MIN_CJK_CHARS  // < 5 chars
    } else {
        const words = trimmed.split(/\s+/).filter((word) => /[a-zA-Z0-9]/.test(word))
        return words.length < MIN_WORD_COUNT  // < 3 words
    }
}
```
