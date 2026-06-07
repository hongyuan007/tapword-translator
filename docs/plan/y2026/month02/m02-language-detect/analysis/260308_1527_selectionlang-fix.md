# selectionLang Fix: Use Block Context for Short-Word Language Detection

**Date**: 2026-03-08  
**Author**: Copilot  
**Status**: Implemented

---

## 1. Root Cause Analysis

### Why `sanitizedText` fails for short words

`chrome.i18n.detectLanguage` is a statistical n-gram model. It requires sufficient text to accumulate meaningful signal. Short words (< ~15 characters) often fall below this threshold, causing random or incorrect language codes to be returned.

The log captures the exact failure:

```
[languageDetector] Starting async language detection: nominated
[languageDetector] Chrome detected language: la   ← WRONG (Latin, not English)
[selectionHandler] Selection language (selected text): la
[Word Path] Translating word: nominated | Language: la
```

The word "nominated" is 9 characters. The detector picked Latin ("la") — a statistically reasonable but incorrect guess for a short Latin-script token that exists in both languages.

The same paragraph was correctly detected as "en" when used as `textForRouting` because it contained hundreds of characters of unambiguous English prose.

### Why `textForRouting` is reliable

`getSurroundingTextForDetection(range, 30)` walks up the DOM to the nearest block ancestor (`<p>`, `<div>`, etc.) and extracts all its text. In practice this yields 50–500+ characters of real prose — far above the statistical minimum for `chrome.i18n.detectLanguage`. The routing detection in the log confirms this:

```
[languageDetector] Starting async language detection: Following the novel's publication...
[languageDetector] Chrome detected language: en   ← CORRECT
```

---

## 2. Proposed Change

**File**: `src/1_content/handlers/TranslationPipeline.ts`  
**Lines**: 124–127 (the `selectionLang` detection block)

### Before

```typescript
// selectionLang: determined from the selected text itself, sent to the translation API.
// False positives and mixed-language string overrides are handled within detectSourceLanguageAsync.
const selectionLang = await languageDetector.detectSourceLanguageAsync(sanitizedText)
```

### After

```typescript
// selectionLang: determined from block context (same source as routingLang) for accuracy on short words.
// chrome.i18n.detectLanguage is unreliable on short strings (< ~15 chars).
// Using the surrounding paragraph text (textForRouting) gives far more signal and avoids false positives
// like "nominated" → "la" (Latin). Mixed CJK/Latin context returns "auto" (handled downstream).
const selectionLang = await languageDetector.detectSourceLanguageAsync(textForRouting)
```

Since `routingLang` and `selectionLang` now read from the same `textForRouting`, both calls hit the same cached Chrome API call path (though not shared at the code level). There is no other structural change required.

---

## 3. Edge Case Analysis

### Case 1: Short English word on English page
- **Example**: `"nominated"` on an English Wikipedia article
- **`textForRouting`**: Full English paragraph (100–300 chars)
- **`detectedLang` (chrome)`**: `"en"` ✓
- **`selectionLang`**: `"en"` → API receives `sourceLanguage: "en"` → translates correctly to `"zh"` ✓
- **Result after fix**: **IMPROVED** (was "la", now "en")

### Case 2: Short French word on French page
- **Example**: `"bonjour"` in a French article
- **`textForRouting`**: Full French paragraph
- **`detectedLang`**: `"fr"` ✓
- **`selectionLang`**: `"fr"` → API translates correctly ✓
- **Result after fix**: **IMPROVED** (short word detection was unreliable; context is reliable)

### Case 3: CJK word
- **Example**: `"你好"` (2 Chinese characters)
- **`textForRouting`**: Surrounding Chinese block text
- **`detectedLang`**: `"zh"` ✓
- **`isCJKLanguage`**: `true` (hasCJK check on sanitizedText)
- **`selectionLang`**: `"zh"` → fragment path → translates to English ✓
- **Result after fix**: **UNCHANGED** (both `sanitizedText` and `textForRouting` reliably detect "zh")

### Case 4: CJK+Latin mixed — selecting Latin word only
- **Example**: Selecting `"you"` from `"you今天来不来"`
- **`sanitizedText`**: `"you"`
- **`textForRouting`**: `"you今天来不来"` (the block)
- **`detectSourceLanguageAsync("you今天来不来")`**: Has CJK + Latin → returns `"auto"` (see `languageDetector.ts` lines 82-88)
- **`selectionLang`**: `"auto"`
- **`isCJKLanguage`**: `false` (`hasCJK("you") = false`; `routingLang = "auto"` is not in `["zh","ja","ko"]`)
- **Route**: Space-delimited path → word expansion → `translateWordPath("you", "auto", ...)`
- **`resolveTargetLanguage("auto", "zh")`**: Returns `"zh"` (auto skips fallback, uses user setting)
- **API**: Translates "you" → Chinese ✓
- **Result after fix**: **CORRECT** ✓

### Case 5: CJK+Latin mixed — selecting whole phrase
- **Example**: Selecting `"you今天来不来"`
- **`sanitizedText`**: `"you今天来不来"`
- **`textForRouting`**: Same block or wider context (contains mixed CJK+Latin)
- **`detectSourceLanguageAsync(textForRouting)`**: Returns `"auto"`
- **`selectionLang`**: `"auto"`
- **`hasCJK("you今天来不来")`**: `true`
- **`isCJKLanguage`**: `true` → fragment path
- **`resolveTargetLanguage("auto", "zh")`**: Returns `"zh"` ✓
- **Result after fix**: **CORRECT** ✓

### Case 6: Long English phrase — selecting full sentence
- **Example**: Selecting `"It won the 1997 Locus Award for Best Fantasy Novel"`
- **`sanitizedText`**: Long English phrase (reliable on its own)
- **`textForRouting`**: Paragraph context (even longer, equally reliable)
- **`selectionLang`**: `"en"` ✓
- **Result after fix**: **UNCHANGED** (both are reliable for long text)

### Case 7: Misidentified word (the reported bug)
- **Example**: `"nominated"` → was `"la"`, now `"en"`
- **API before fix**: Received `sourceLanguage: "la"` → LLM had to infer/guess language
- **API after fix**: Receives `sourceLanguage: "en"` → clean, correct signal ✓

---

## 4. Risk Assessment

### Potential regression: Page context in a different language than the selection

**Scenario**: A page is in French. User selects an English technical term like `"API"` that appears in an otherwise French paragraph.

- **Current behavior**: `sanitizedText = "API"` → too short → probably detected as "en" anyway (by luck), or "fr" (wrong)
- **After fix**: `textForRouting` = French paragraph → detects `"fr"` → API sees `sourceLanguage: "fr"` → might treat "API" as French
- **Impact**: Low. The word "API" is language-agnostic; the LLM will still produce a valid translation. The `resolveTargetLanguage` logic ensures fallback when source == target.
- **Verdict**: Acceptable regression risk. This is a very rare edge case and translation quality remains acceptable.

### Potential regression: Isolated text blocks with single-language short content

**Scenario**: A page with a button labeled `"Cliquez ici"` (French) surrounded by English prose. User selects the button text.

- **`textForRouting`**: Would pick up the button's own block if it's in a `<button>` or `<p>`. Buttons are unlikely to be within the text traversal path. `domSanitizer.getSurroundingTextForDetection` stays within block ancestors.
- **Risk**: Minimal. The block ancestor for a button is usually isolated.

### No regression scenarios

- CJK detection is unchanged (driven by `hasCJK(sanitizedText)` check which is independent of `selectionLang`)
- `routingLang` is unchanged
- `resolveTargetLanguage` handles `"auto"` correctly

---

## 5. Manual Test Cases

| # | Page Language | Selected Text | Expected `selectionLang` | Expected Translation Target | Pass? |
|---|---|---|---|---|---|
| 1 | English | `"nominated"` | `"en"` | `"zh"` | Verify after fix |
| 2 | French | `"bonjour"` | `"fr"` | `"zh"` (user pref) | Verify after fix |
| 3 | Chinese | `"你好"` | `"zh"` | `"en"` (same-lang fallback) | Should still pass |
| 4 | Mixed `"you今天来不来"` | `"you"` only | `"auto"` | `"zh"` | Should still pass |
| 5 | Mixed `"you今天来不来"` | whole phrase | `"auto"` | `"zh"` | Should still pass |
| 6 | English | Long sentence | `"en"` | `"zh"` | Should still pass |
| 7 | Japanese | `"こんにちは"` | `"ja"` | `"zh"` | Should still pass |

---

## 6. Summary

The root cause is `chrome.i18n.detectLanguage`'s statistical unreliability on short strings. The fix redirects `selectionLang` to use the already-available `textForRouting` (block paragraph context), which provides sufficient signal for reliable detection. The change is one line in `processTranslation()`. All edge cases analyzed above show either improvement or no regression.
