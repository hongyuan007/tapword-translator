# Progress: Issue #41 - 句子范围识别优化

## Task Info
- **Issue**: #41 - [BUG] 双击翻译句子，需要优化句子范围识别
- **Type**: Bug
- **Priority**: 1 (Queue top)
- **Workflow**: A (Standard: Research → Implement → Verify → Review → PR)
- **Started**: 2026-03-23

## Problem Description
When double-clicking to translate a sentence, commas within numbers (e.g., "10,000") are incorrectly treated as sentence delimiters, breaking sentence boundary detection.

## Phases
- [x] Phase 1: Research & Spec
- [x] Phase 2: Implementation
- [ ] Phase 3: Verification
- [ ] Phase 4: Code Review
- [ ] Phase 5: PR

## Phase 2: Implementation Details

### Files Modified
| File | Change |
|---|---|
| `src/1_content/utils/contextExtractorV2.ts` | Added `isCommaInsideNumber()` and `isPeriodInsideNumber()` helpers; modified `firstTerminatorIndex()` and `lastTerminatorIndex()` with `skipNumeric` flag; updated `findSentenceEndWithin()` and `findSentenceStartWithin()` to pass flag; enabled flag in all `expandRangeToSentence` calls |
| `tests/1_content/utils/expandRangeToSentence.test.ts` | **New file** — 13 unit tests covering numeric commas, decimal periods, grammatical commas, CJK, and edge cases |

### Changes Summary
1. **`isCommaInsideNumber(text, index)`** — returns `true` when a comma (`,` or `，`) has digits on both sides (e.g., `10,000`)
2. **`isPeriodInsideNumber(text, index)`** — returns `true` when a `.` has digits on both sides (e.g., `3.14`)
3. **`firstTerminatorIndex` / `lastTerminatorIndex`** — added `skipNumeric: boolean = false` parameter; when true, skips commas/periods detected as numeric
4. **`findSentenceEndWithin` / `findSentenceStartWithin`** — added `skipNumeric` parameter, forwarded to terminator index functions
5. **`expandRangeToSentence`** — passes `skipNumeric: true` for both hard and soft terminator searches (decimal and comma protection in one pass)
6. **`extractContextV2`** — **NOT modified** (uses hard terminators only, no skipNumeric flag)

### Verification Results
- **Type-check**: ✅ Pass (only pre-existing `ServiceInitializer.ts` error remains)
- **New tests**: ✅ 13/13 pass
- **Existing tests**: ✅ No regression (21 pre-existing failures in `contextExtractorV2.test.ts` remain unchanged — unrelated `domSanitizer` jsdom issue)
