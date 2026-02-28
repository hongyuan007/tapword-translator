# Bug Analysis & Fix: Issue #24 – English Word on Mixed-Language Page Translates to English

| Field | Detail |
|---|---|
| Issue | [#24](https://github.com/hongyuan007/tapword-translator/issues/24) |
| Status | OPEN |
| Date | 2026-02-28 |
| Affected File | `src/1_content/handlers/TranslationPipeline.ts` |
| Reproduction Test | `tests/e2e/specs/issue-24-mixed-language-translation.spec.ts` |

---

## 1. Bug Description

On pages that mix Chinese and English text (e.g., a Chinese tech article that uses English technical terms), selecting an English word and triggering translation returns an **English** translation instead of Chinese — even when the user's target language is set to `zh`.

**Example:** Selecting the word `performance` inside a Chinese paragraph produces `"performance"` as the translation result (no change).

---

## 2. Root Cause: Step-by-Step

### Step 1 – Language detection uses **surrounding block text**, not the selected word

`processTranslation()` in `TranslationPipeline.ts` calls:

```typescript
// Get surrounding text from block ancestor for more accurate language detection
const textForDetection = domSanitizer.getSurroundingTextForDetection(range, 30)
const detectedLang = await languageDetector.detectSourceLanguageAsync(textForDetection)
```

`getSurroundingTextForDetection()` expands outward from the selection to collect at least 150 characters of context from the surrounding block element. On a Chinese page, this returns the full Chinese paragraph — including the selected English word buried in it.

### Step 2 – Chrome detects the block as Chinese (`zh`)

`chrome.i18n.detectLanguage` is fed the Chinese paragraph text and returns `zh`, even though the **selected word itself** is English.

```
[languageDetector] Chrome detected language: zh
[selectionHandler] [Icon Click] Detected language: zh
```

### Step 3 – Code routes to the CJK fragment path

```typescript
const isCJKLanguage = ["zh", "ja", "ko"].includes(detectedLang) // true

if (isCJKLanguage) {
    // Treats the selected English word as a CJK fragment
    await translateFragmentPath(workingRange, fragment, detectedLang, ...)
}
```

The English word `"performance"` is now treated as a **Chinese fragment** with `sourceLanguage = "zh"`.

### Step 4 – `resolveTargetLanguage("zh", "zh")` triggers the zh→en fallback

Inside `translateFragmentPath()`:

```typescript
const userTargetLang = userSettings?.targetLanguage  // "zh"
const targetLang = languageDetector.resolveTargetLanguage(detectedLang, userTargetLang)
// resolveTargetLanguage("zh", "zh") → source == target → applies zh→en fallback → returns "en"
```

```
[languageDetector] Source language (zh) matches target language (zh), applying fallback
[languageDetector] Chinese -> English fallback applied
[Fragment Path] Target language: en (user setting: zh)
```

### Step 5 – API receives wrong parameters

The request sent to the backend:

```json
{
  "fragment": "performance",
  "sourceLanguage": "zh",
  "targetLanguage": "en"
}
```

The backend is asked to translate `"performance"` from Chinese to English, so it returns `"performance"` unchanged.

---

## 3. Confirmed via E2E Test

The reproduction test `issue-24-mixed-language-translation.spec.ts`:

1. Serves a Chinese article HTML page containing `<span id="target-word">performance</span>`
2. Pre-seeds `targetLanguage: "zh"` in `chrome.storage.sync` via the service worker
3. Uses the JS Selection API to select exactly the word `"performance"` (avoids triple-click paragraph expansion)
4. Clicks the translation icon
5. Asserts the tooltip contains at least one CJK character `/[\u4e00-\u9fff]/`

**Test result (bug present):**
```
Error: Expected Chinese characters in translation output, but got: "performance"
```

---

## 4. Fix

The fix must decouple two concerns that are currently conflated:

| Concern | Correct Input |
|---|---|
| **Routing** (word boundary expansion, CJK vs space-delimited) | Block-level surrounding text |
| **`sourceLanguage` sent to API** | The **selected text itself** |

### Fix location: `processTranslation()` in `TranslationPipeline.ts`

Add a second language detection call on the **raw selected text** and use it as `sourceLanguage`, while keeping the block-level detection only for routing decisions.

```typescript
async function processTranslation(
    range: Range,
    triggerSource: string,
    limiter?: RequestLimiter,
    loadingVariant: "text" | "spinner" = "text"
): Promise<void> {
    const rawText = domSanitizer.getCleanTextFromRange(range)
    const sanitizedText = rawText.trim()
    logger.info(`[${triggerSource}] Translation requested for:`, sanitizedText)

    // Detect block-level language → used ONLY for routing (CJK vs space-delimited)
    const textForRouting = domSanitizer.getSurroundingTextForDetection(range, 30)
    const routingLang = await languageDetector.detectSourceLanguageAsync(textForRouting)
    logger.info(`[${triggerSource}] Routing language (block context):`, routingLang)

    // Detect selection-level language → used as sourceLanguage sent to the API
    const selectionLang = await languageDetector.detectSourceLanguageAsync(sanitizedText)
    logger.info(`[${triggerSource}] Selection language (selected text):`, selectionLang)

    const isCJKLanguage = ["zh", "ja", "ko"].includes(routingLang)

    if (isCJKLanguage) {
        logger.info(`[${triggerSource}] [CJK Page] Treating selection as fragment`)
        const trimRes = rangeAdjuster.trimBoundaryWhitespace(range)
        const workingRange = trimRes.range
        const fragment = domSanitizer.getCleanTextFromRange(workingRange).trim()
        // Pass selectionLang (not routingLang) so the API knows the actual language of the selected text
        await translateFragmentPath(workingRange, fragment, selectionLang, limiter, loadingVariant)
    } else {
        // ... existing space-delimited path, also using selectionLang
    }
}
```

### Why this works

With the word `"performance"` selected on a Chinese page:

| | Before fix | After fix |
|---|---|---|
| `routingLang` | `zh` | `zh` (unchanged, from block text) |
| `selectionLang` | n/a | `en` (from the selected word) |
| Route taken | CJK fragment | CJK fragment (unchanged) |
| `sourceLanguage` in API request | `zh` | `en` ✓ |
| `resolveTargetLanguage("en", "zh")` | n/a | `"zh"` (no conflict) ✓ |
| API result | `"performance"` | Chinese translation ✓ |

The routing behaviour for genuine CJK selections (Chinese text on a Chinese page) is **unaffected** — `selectionLang` will also be `zh`, and `resolveTargetLanguage("zh", "zh")` correctly applies the zh→en fallback in that case.

---

## 5. Edge Cases to Verify After Fix

| Scenario | Expected `sourceLanguage` | Expected `targetLanguage` (user=zh) |
|---|---|---|
| English word on Chinese page | `en` | `zh` ✓ |
| Chinese word on Chinese page | `zh` | `en` (fallback) ✓ |
| Chinese word on English page | `zh` | `en` (fallback) ✓ |
| English word on English page | `en` | `zh` ✓ |
| Japanese word on Chinese page | `ja` | `zh` ✓ |

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/1_content/handlers/TranslationPipeline.ts` | Add `selectionLang` detection; pass it as `detectedLang` to translation paths |
| `tests/e2e/specs/issue-24-mixed-language-translation.spec.ts` | New E2E test (reproduces the bug, will pass after fix) |
| `tests/html/issue-24-mixed-language.html` | New HTML fixture for the test |
